/**
 * In-process DIRSPAWN subagent backend: registers a {@link SubagentProvider} on
 * `ctx.subagents` that runs each child as a fresh in-process child agent
 * hard-confined to ONE directory.
 *
 * Confinement layers, strongest first:
 * 1. The child session's `cwd` IS the confined directory and its sandbox mode
 *    is pinned to `workspace-write` — the file sandbox's write boundary.
 * 2. A monotonic tool guard registered in the child's scope validates the path
 *    argument of `read`/`write`/`edit`/`glob`/`grep`/`read_image` (absolute,
 *    relative, and `..` escapes) before the tool body runs.
 * 3. Skills stay available to every child (the catalog is instruction
 *    knowledge, never a path grant). Shell tools (pwsh/bash) are removed by
 *    default (visibility plus name denial) but grantable per child through the
 *    request's `allowedTools`. Delegation tools (subagent/workflow/ralph), the
 *    `dirspawn` tool itself, and the `cordis_*` dynamic-plugin tools are never
 *    grantable, so the child cannot spawn unguarded grandchildren or define
 *    plugins that read the host filesystem.
 * 4. The child's approval policy is pinned to `never`, so sandbox escalation
 *    (including `danger-full-access`) is impossible.
 *
 * The provider is one-shot only (no `prepareContinuable`), like the shipped
 * spawn backend but with its own child driver: the built-in in-process driver
 * always stamps the PARENT's cwd, while this backend must stamp the confined
 * directory.
 * @module dsh-dirspawn
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionId, SessionLogOffset as SessionLogOffsetType, TurnEndReason } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  assertSubagentMaxDepth,
  finalAssistantOutput,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentDescriptorData,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type { ToolGuard, ToolRestriction } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { normalizeAbs, resolveInside } from './path.ts'

export const name = 'subagent-dirspawn'

// `tools` is deliberately not injected — the child factory already provides it
// during setup, and adding it here would change this provider's apply timing.
export const inject = ['subagents']

/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `dirspawn`). */
  providerName: string
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('dirspawn'),
})

/**
 * Confinement payload carried as an extra field on the start request. The
 * subagents service resolves `{ ...request, descriptor }`, so this field
 * reaches the provider verbatim; start children through the companion
 * `dsh-dirspawn/tool` row, which always supplies it.
 */
export interface DirspawnConfine {
  /** Absolute directory the child may read and write; everything else is denied. */
  readonly root: string
  /** Whether pwsh/bash stay enabled (workdir confined; arbitrary shell reads remain possible). */
  readonly allowShell: boolean
  /** Extra tool names the delegating agent granted; never-grantable names are ignored. */
  readonly allowedTools?: readonly string[]
}

/** The start request a dirspawn child carries. */
export interface DirspawnStartRequest extends ResolvedSubagentStartRequest {
  readonly confine?: DirspawnConfine
}

/**
 * Tools that must NEVER run inside a confined child, not even when the
 * delegating agent asks for them: delegation (grandchildren would not inherit
 * the guard), the dynamic plugin tools (a child could define a plugin that
 * reads the host filesystem), and the web tools (a child works only from its
 * directory, not from material found online). Skills are intentionally NOT
 * listed here: they stay available to every child as read-only instruction
 * knowledge.
 */
const DENY_TOOLS = [
  'dirspawn',
  'subagent', 'subagent_fork', 'workflow', 'ralph',
  'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
  'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
  'web_search', 'web_fetch',
] as const

/** Tools that are removed by default but grantable through `allowedTools`. */
const DEFAULT_DENIED_GRANTABLE = ['pwsh', 'bash'] as const

/** Which argument field carries the path, per guarded tool. */
const PATH_FIELDS: Readonly<Record<string, string>> = {
  read: 'file_path',
  write: 'file_path',
  edit: 'file_path',
  read_image: 'file_path',
  glob: 'path',
  grep: 'path',
}

/** Error used when cancellation wins before the child publication boundary. */
function prePublicationAbort(): Error {
  return new Error('dirspawn request was aborted before child publication')
}

/** Map a session turn outcome to the subagent seam's terminal vocabulary. */
function toStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    case 'blocked':
      return 'refusal'
    case 'error':
    case 'interrupted':
    default:
      return 'error'
  }
}

/** The tool-registry surface the confinement setup needs. */
interface ToolsLike {
  restrict(filter: ToolRestriction): unknown
  schemas(): readonly { name: string }[]
}

/**
 * Apply a tool filter best-effort: `restrict()` validates names against the
 * scope's known tools, so names this scope does not know (scoped tools,
 * platform-specific shells) are dropped. The monotonic guard below still
 * hard-denies every name on the full list, so a dropped name costs visibility
 * only, never enforcement.
 * @param tools - the child scope's tool registry.
 * @param filter - the intended restriction.
 */
function safeRestrict(tools: ToolsLike, filter: ToolRestriction): void {
  let known: string[] = []
  try {
    known = tools.schemas().map(schema => schema.name)
  } catch {
    known = []
  }
  const narrowed: ToolRestriction = {
    ...(filter.allow !== undefined ? { allow: filter.allow.filter(inner => known.includes(inner)) } : {}),
    ...(filter.deny !== undefined ? { deny: filter.deny.filter(inner => known.includes(inner)) } : {}),
  }
  tools.restrict(narrowed)
}

/**
 * The monotonic per-call guard installed in the CHILD's scope: it denies
 * forbidden tool names and any path argument that escapes the confined root.
 * Guards have no allow result, so nothing the child registers can overturn a
 * denial.
 * @param root - the absolute confined directory.
 * @param allowShell - whether pwsh/bash stay enabled (workdir still confined).
 * @param allowedTools - extra tool names granted by the delegating agent.
 * @returns the guard for `ctx.tools.guard`.
 */
function makeGuard(root: string, allowShell: boolean, allowedTools: readonly string[]): ToolGuard {
  const rootKey = normalizeAbs(root)
  const granted = new Set<string>(allowedTools)
  const shellEnabled = (tool: string): boolean => allowShell || granted.has(tool)
  const denied = new Set<string>(DENY_TOOLS)
  if (!shellEnabled('pwsh')) denied.add('pwsh')
  if (!shellEnabled('bash')) denied.add('bash')
  return (execution) => {
    const toolName = execution.name
    if (denied.has(toolName)) {
      return `tool "${toolName}" is unavailable inside the confined directory "${root}"`
    }
    const args = execution.arguments
    if (toolName === 'pwsh' && shellEnabled('pwsh')) {
      if (args === null || typeof args !== 'object') return undefined
      const workdir = (args as { workdir?: unknown }).workdir
      if (typeof workdir !== 'string' || workdir.length === 0) return undefined
      if (rootKey === null || resolveInside(rootKey, workdir) === null) {
        return `pwsh workdir "${workdir}" escapes the confined directory "${root}"`
      }
      return undefined
    }
    const field = PATH_FIELDS[toolName]
    if (field === undefined) return undefined
    if (args === null || typeof args !== 'object') return undefined
    const path = (args as Record<string, unknown>)[field]
    if (typeof path !== 'string' || path.length === 0) return undefined
    if (rootKey === null || resolveInside(rootKey, path) === null) {
      return `path "${path}" escapes the confined directory "${root}"`
    }
    return undefined
  }
}

/** Model-facing confinement statement for one child. */
function confinementStatement(root: string, allowShell: boolean, allowedTools: readonly string[]): string {
  const granted = new Set<string>(allowedTools)
  const shellOn = allowShell || granted.has('pwsh') || granted.has('bash')
  const lines = [
    'You are a delegated subagent CONFINED to one directory.',
    `Confined directory (the only path you may read or write): ${root}`,
    '- Every file-tool call naming a path outside the confined directory is denied by a runtime guard before the tool runs.',
    '- Your writes are additionally sandbox-contained to the confined directory; approval is disabled in this session, so escalation beyond it is impossible.',
    '- The skill tool is available to you. Skill instructions come from outside the confined directory; use them as knowledge only, never as a reason to access paths outside it.',
  ]
  if (shellOn) {
    lines.push('- Shell commands (pwsh/bash) are available, but their workdir must stay inside the confined directory. Shell commands can still read arbitrary paths, so never use them to touch files outside the confined directory.')
  }
  lines.push(shellOn
    ? '- Dynamic-plugin tools and delegation tools (subagent/workflow/ralph) are unavailable to you.'
    : '- Shell commands (pwsh/bash), dynamic-plugin tools, and delegation tools (subagent/workflow/ralph) are unavailable to you.')
  lines.push('When the task needs access beyond the confined directory, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.')
  return lines.join('\n')
}

/** Append one one-shot descriptor inside the child's initial turn before its first request. */
function attachDescriptorAppend(childCtx: Context, descriptor: SubagentDescriptorData): void {
  let appended = false
  childCtx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      agent.session.append('subagent/descriptor', descriptor)
    }
    return decision
  })
}

/**
 * Compose one confined child inside its unpublished creation window: the
 * parent's preset join and per-child composition (both shared with the
 * built-in spawn backend), then the dirspawn-only layers — the pinned policy,
 * the confinement statement, the tool denial, and the path guard.
 * @param childCtx - the unpublished child's scoped context.
 * @param parent - the delegating parent agent.
 * @param request - the resolved start request.
 * @param confine - the confinement payload.
 */
function setupConfinement(
  childCtx: Context,
  parent: Agent,
  request: ResolvedSubagentStartRequest,
  confine: DirspawnConfine,
): void {
  const child = childCtx.agent
  if (child === undefined) throw new Error('dirspawn: child setup ran without the child agent association')
  // The parent's preset join and the per-child persona/toolFilter, exactly as
  // the built-in spawn backend applies them.
  applyChildComposition(childCtx, parent, { persona: request.persona, toolFilter: request.toolFilter })
  // Fixed policy: writes are contained to the confined cwd, approvals are
  // rejected, and both facts are durable on the child's own log.
  appendDelegatedPolicyOverrides(child.session, {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
  })
  const granted = new Set<string>(confine.allowedTools ?? [])
  const deny = [...DENY_TOOLS, ...DEFAULT_DENIED_GRANTABLE.filter((tool) => !(confine.allowShell || granted.has(tool)))]
  childCtx.systemPrompt.context({
    name: 'dirspawn:confinement',
    order: childCtx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: confinementStatement(confine.root, confine.allowShell, confine.allowedTools ?? []),
  })
  safeRestrict(childCtx.tools, { deny })
  childCtx.tools.guard(makeGuard(confine.root, confine.allowShell, confine.allowedTools ?? []))
  attachDescriptorAppend(childCtx, request.descriptor)
}

/**
 * Create and publish the confined child: fresh session, no parent context,
 * `cwd` = the confined directory, guarded tools, fixed policy.
 * @param request - the trusted typed start request, including its required signal.
 * @param confine - the confinement payload supplied by the dirspawn tool.
 * @returns a published holder-owned run.
 */
async function startDirspawnRun(
  request: ResolvedSubagentStartRequest,
  confine: DirspawnConfine,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) throw prePublicationAbort()
  const parent = request.parent
  const childDepth = resolveChildDepth(parent, request.maxDepth)
  const childId = brandString<SessionId>(randomUUID())
  const activationBoundary = SessionLogOffset(0)

  const agentPreset = parent.ctx.get('agentPresets')?.composedPreset(parent.ctx)
  const handle = await parent.ctx.agents.create({
    sessionId: childId,
    meta: {
      cwd: confine.root,
      parentSession: parent.id,
      isSeeded: false,
      origin: 'subagent',
      delegationDepth: childDepth,
      ...(agentPreset !== undefined ? { agentPreset } : {}),
    },
    agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
    signal: request.signal,
    setup: (childCtx: Context): void => { setupConfinement(childCtx, parent, request, confine) },
  })
  return drivePublishedRun(handle, request, childId, activationBoundary)
}

/**
 * Wrap a published child in the single run lifecycle that owns signal handoff,
 * one turn, result settlement, and quiescent disposal.
 * @param handle - the published child handle.
 * @param request - the resolved start request.
 * @param childId - the child's session id.
 * @param boundary - the child-owned event boundary (always the log start: no seed).
 * @returns the holder-owned run.
 */
function drivePublishedRun(
  handle: AgentHandle,
  request: ResolvedSubagentStartRequest,
  childId: SessionId,
  boundary: SessionLogOffsetType,
): SubagentRun {
  const child = handle.agent
  const flags = { cancelled: false }
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  // Agent creation detaches its creation-only listener before returning. The
  // post-registration check closes that handoff without treating an already
  // published child as a failed start.
  if (request.signal.aborted) onAbort()

  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!flags.cancelled) {
        child.followup(createUserMessage({ content: request.prompt, source: { kind: 'user' } }))
        await child.whenIdle()
      }
      return readResult(child, boundary, flags.cancelled)
    } finally {
      request.signal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    id: childId,
    localAgent: child,
    result,
    async dispose(): Promise<void> {
      request.signal.removeEventListener('abort', onAbort)
      flags.cancelled = true
      const settlements = await Promise.allSettled([handle.dispose(), result])
      const disposal = settlements[0]
      // The result channel owns run faults; disposal reports only failure to
      // release the published handle after both operations settle.
      if (disposal.status === 'rejected') throw disposal.reason
    },
  }
}

/** Read one settled child's result from events after its activation boundary. */
function readResult(
  child: Agent,
  boundary: SessionLogOffsetType,
  cancelled: boolean,
): SubagentResult {
  const own = child.session.snapshotEvents(boundary)
  const lastEnd = foldConsumedWork(own).end
  // The seam's canonical selection rule; a partial answer survives cancel and truncation.
  const output: ContentBlock[] = finalAssistantOutput(own) ?? []
  const recorded = toStopReason(lastEnd?.data.reason)
  // Disposal can tear the owner down before the loop records its ordinary
  // `aborted` end, yielding `disposed` instead.
  const stopReason: SubagentStopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded
  return { output, stopReason }
}

/**
 * The dirspawn provider. Supports every start-time capability the tool uses:
 * `depthLimit` (it constructs the child, so it can enforce a recursion cap),
 * `agentOptions` (merged over the parent route), and `toolFilter`/`persona`
 * (scoped `restrict()` and a scoped shadowing persona section, applied in the
 * child's creation window). No `outputSchema`, and no `prepareContinuable`:
 * dirspawn children are one-shot by design.
 */
class DirspawnProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: false,
    depthLimit: true,
    toolFilter: true,
    persona: true,
  }
  // Context contract: a dirspawn child starts fresh — it never sees the parent conversation.
  readonly inheritsParentContext = false

  constructor(readonly name: string) {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const confine = (request as DirspawnStartRequest).confine
    if (confine === undefined) {
      throw new Error('dirspawn: request is missing its confinement payload; start children through the dirspawn tool')
    }
    return startDirspawnRun(request, confine)
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerProvider(new DirspawnProvider(config.providerName))
}
