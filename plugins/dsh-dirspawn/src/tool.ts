/**
 * Model-facing `dirspawn` tool: runs a one-shot subagent hard-confined to ONE
 * directory through the `dirspawn` provider on `ctx.subagents`. Foreground by
 * default: the call waits for the child to finish and returns its final text.
 * `run_in_background: true` starts the same run through the jobs service and
 * returns a job id immediately (collect with `job_output`, stop with
 * `job_kill`).
 *
 * The confinement payload (`root` + `allowShell` + optional `allowedTools`)
 * rides the start request as an extra `confine` field, which the subagents
 * service preserves verbatim.
 * @module dsh-dirspawn/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { settleRun } from '@deepseek-ai/dsh-subagent'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

export const name = 'tool-dirspawn'

export const inject = ['tools', 'subagents']

/** Config: which registered provider this tool delegates to. */
export interface Config {
  /** The `ctx.subagents` provider name to start runs on (default `dirspawn`). */
  provider: string
  /** Model-facing tool name (default `dirspawn`). */
  toolName?: string
}

export const Config: z<Config> = z.object({
  provider: z.string().default('dirspawn'),
  toolName: z.string().default('dirspawn'),
})

/** The confinement payload the companion provider reads from the start request. */
interface DirspawnToolStartRequest extends SubagentStartRequest {
  readonly confine: {
    /** Absolute directory the child may read and write. */
    readonly root: string
    /** Whether pwsh/bash stay enabled in the child. */
    readonly allowShell: boolean
    /** Extra tool names the delegating agent granted to this child. */
    readonly allowedTools?: readonly string[]
  }
}

/** The minimal filesystem seam the tool needs from the calling agent's context. */
interface FileSystemLike {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other' } | undefined>
  processPath(target: unknown): string
}

/** The tool's canonical result value. */
interface DirspawnResult {
  runId: string
  directory: string
  stopReason: string
  output: JsonValue[]
}

/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values: JsonValue[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'dirspawn run was cancelled'
    case 'error':
      return 'dirspawn run failed'
    case 'max-tokens':
      return 'dirspawn run hit its token limit before finishing'
    case 'refusal':
      return 'dirspawn declined the task'
    default:
      return `dirspawn run ended abnormally (${String(result.stopReason)})`
  }
}

/** Append the child's preserved partial answer to a stop-reason headline. */
function withDiagnosticAndPartialText(error: string, result: SubagentResult): string {
  const text = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const partial = text.length === 0 ? '' : `\nPartial output before the run ended:\n${text}`
  return error + partial
}

/**
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure. The result settles FIRST, then the handle is
 * disposed — disposing early would cancel the still-running child (the
 * built-in subagent tool sequences it the same way).
 * @param run - the published holder-owned run.
 * @param root - the confined directory, echoed in the result.
 * @returns the tool's canonical result value.
 */
async function settleForegroundRun(run: SubagentRun, root: string): Promise<DirspawnResult> {
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError([execution.reason, disposal.reason], 'dirspawn run and dispose both failed')
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  const result = execution.value
  const error = stopReasonError(result)
  if (error !== undefined) throw new Error(withDiagnosticAndPartialText(error, result))
  return {
    runId: run.id,
    directory: root,
    stopReason: result.stopReason,
    output: result.output as unknown as JsonValue[],
  }
}

/** The job-settlement shape the jobs service expects, mirrored structurally. */
interface JobOutcomeLike {
  status: 'completed' | 'killed' | 'failed'
  detail?: string
  output?: string
}

/** Minimal surface of the `jobs` service the background route needs. */
interface JobsLike {
  start(spec: {
    kind: 'subagent'
    label?: string
    owner: unknown
    run: () => { cancel: (reason?: string) => void; done: Promise<JobOutcomeLike> }
  }): string
}

/** Settle a background child's startup without rejecting the task-producer contract. */
async function settleBackgroundStart(start: Promise<SubagentRun>, signal: AbortSignal): Promise<JobOutcomeLike> {
  try {
    return await settleRun(await start)
  } catch (error: unknown) {
    return signal.aborted && !(error instanceof AggregateError)
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

export function apply(ctx: Context, config: Config): void {
  const toolName = config.toolName ?? 'dirspawn'
  ctx.tools.register(defineTool({
    name: toolName,
    description: 'Run a one-shot subagent that is hard-confined to ONE directory: the child cannot read or write anything outside it. '
      + 'Its file tools (read, write, edit, glob, grep, read_image) are always available and path-guarded to the directory, its '
      + 'writes are additionally sandbox-contained to it, and escalation to full access is impossible (approval is pinned off in '
      + 'the child). The skill tool is available by default (its instruction catalog lives outside the confined directory; skill '
      + 'content is knowledge, not a path grant). Shell tools (pwsh/bash) are off by default; delegation tools '
      + '(subagent/workflow/ralph/dirspawn), the dynamic-plugin tools, and the web tools (web_search/web_fetch) are NEVER grantable. allowed_tools re-enables pwsh/bash '
      + 'per child (workdir stays confined; arbitrary shell commands can still READ outside paths). The optional persona and '
      + 'model parameters customize the child per call: persona shadows the default persona, model overrides the model id while '
      + 'the provider is inherited from the parent route. The call runs in the foreground by default: it waits for the child to '
      + 'finish and returns the child\'s final text. Set run_in_background=true to return a job id immediately; collect the '
      + 'result with job_output and stop the run with job_kill.',
    parameters: {
      directory: {
        type: 'string',
        required: true,
        description: 'The directory the subagent is confined to — an absolute path, or a path relative to the current session workspace. The child cannot read or write any path outside it.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete, self-contained task for the confined subagent. It does not see this conversation.',
      },
      description: {
        type: 'string',
        description: 'Optional short (3-5 word) label for the child, shown in subagent listings.',
      },
      allow_shell: {
        type: 'boolean',
        description: 'Default false. When true the child keeps pwsh/bash (workdir confined to the directory, writes still sandbox-contained). Shell commands can still READ files outside the directory, so leave false for hard read+write confinement.',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of additional tool names to enable in the child on top of its default tools. Grantable: pwsh/bash (workdir confined; shell can still read outside). Skill is already available by default. Delegation, dynamic-plugin and web tools are never grantable; unknown names are ignored.',
      },
      persona: {
        type: 'string',
        description: 'Optional persona instructions applied to this child only, shadowing the default persona before its first request.',
      },
      model: {
        type: 'string',
        description: 'Optional model id override for this child. The provider is inherited from the parent route; the model must be one that provider serves.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Default false: the call waits for the child and returns its final text. When true the call returns immediately with a job id; collect the result with job_output and stop the run with job_kill.',
      },
      max_depth: {
        type: 'integer',
        description: 'Optional absolute cap on the child delegation depth (default 3).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string' },
          jobId: { type: 'string' },
          directory: { type: 'string', required: true },
          stopReason: { type: 'string' },
          output: { type: 'array', items: { type: 'json' } },
        },
      },
      render: (_args, value) => {
        if (typeof value.jobId === 'string') {
          return [{ type: 'text', text: `Started background dirspawn run in "${value.directory}" (job id: ${value.jobId}). Collect the result with job_output; stop it with job_kill.` }]
        }
        return [{ type: 'text', text: outputValueText(value.output ?? []) || `(no text output; stopReason: ${value.stopReason})` }]
      },
    },
    // Children never mutate the parent session; each call owns its own child.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { directory, prompt, description, allow_shell: allowShellArg, max_depth: maxDepthArg, allowed_tools: allowedToolsArg, persona: personaArg, model: modelArg, run_in_background: runInBackgroundArg } = args
      const parent = exec.agent
      if (parent === undefined) throw new Error('dirspawn requires a calling agent')
      const fs = parent.ctx.get('fs') as FileSystemLike | undefined
      if (fs === undefined) throw new Error('dirspawn requires the fs service on the parent context')

      const parentCwd = parent.session.header.cwd
      const target = await fs.resolve(directory, parentCwd === undefined
        ? { signal: exec.signal }
        : { cwd: parentCwd, signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (info === undefined) throw new Error(`confined directory does not exist: ${directory}`)
      if (info.type !== 'directory') throw new Error(`confined path is not a directory: ${directory}`)
      const root = fs.processPath(target)
      if (typeof root !== 'string' || root.length === 0) {
        throw new Error(`the fs backend returned no host path for: ${directory}`)
      }

      const maxDepth = typeof maxDepthArg === 'number' ? maxDepthArg : 3
      const allowShell = allowShellArg === true
      const allowedTools = Array.isArray(allowedToolsArg)
        ? [...new Set(allowedToolsArg.filter((tool): tool is string => typeof tool === 'string'))]
        : []
      const persona = typeof personaArg === 'string' && personaArg.length > 0 ? personaArg : undefined
      const model = typeof modelArg === 'string' && modelArg.length > 0 ? modelArg : undefined
      const request: DirspawnToolStartRequest = {
        prompt: [{ type: 'text', text: prompt }],
        parent,
        signal: exec.signal,
        ...(typeof description === 'string' && description.length > 0 ? { label: description } : {}),
        ...(persona !== undefined ? { persona } : {}),
        ...(model !== undefined ? { agentOptions: { model } } : {}),
        maxDepth,
        confine: { root, allowShell, ...(allowedTools.length > 0 ? { allowedTools } : {}) },
      }

      if (runInBackgroundArg === true) {
        const jobs = ctx.get('jobs') as JobsLike | undefined
        if (jobs === undefined) throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        const jobId = jobs.start({
          kind: 'subagent',
          label: typeof description === 'string' && description.length > 0 ? description : 'dirspawn',
          owner: parent,
          run: () => {
            const controller = new AbortController()
            const start = ctx.subagents.start(config.provider, { ...request, signal: controller.signal })
            return {
              cancel: (reason?: string) => { controller.abort(reason ?? 'background dirspawn task killed') },
              done: settleBackgroundStart(start, controller.signal),
            }
          },
        })
        return { jobId, directory: root }
      }

      const run = await ctx.subagents.start(config.provider, request)
      return settleForegroundRun(run, root)
    },
  }))
}
