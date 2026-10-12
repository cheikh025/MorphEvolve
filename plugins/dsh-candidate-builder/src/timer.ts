/** Per-worker elapsed-time budget, armed by the first model attempt. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ContextFormed, MessageId, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'

export interface WorkerTimerOptions {
  /** Defaults to 600 seconds; zero disables the timer. */
  readonly timeoutSeconds?: number
  /** Remaining seconds at which to warn; zero disables the warning. */
  readonly warningSeconds?: number
}

export interface ResolvedWorkerTimer {
  readonly timeoutSeconds: number
  readonly warningSeconds: number
}

export interface WorkerTiming {
  readonly timeoutSeconds: number
  readonly warningSeconds: number
  readonly startedAt?: number
  readonly deadline?: number
  readonly elapsedSeconds: number
  readonly warningQueued: boolean
  readonly timedOut: boolean
}

export interface TimedSubagentResult extends SubagentResult {
  readonly timing?: WorkerTiming
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'candidate-builder:timer': { kind: 'candidate-builder:timer' } & ContextFormed
  }
}

// Node's setTimeout overflows beyond this range and would fire immediately.
const MAX_SECONDS = Math.floor(2_147_483_647 / 1000)

export function resolveWorkerTimer(options: WorkerTimerOptions): ResolvedWorkerTimer | undefined {
  const timeoutSeconds = options.timeoutSeconds ?? 600
  const warningSeconds = options.warningSeconds ?? Math.min(120, timeoutSeconds)
  for (const [name, value] of Object.entries({ timeoutSeconds, warningSeconds })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SECONDS) {
      throw new Error(`candidate-builder: ${name} must be an integer from 0 to ${MAX_SECONDS}`)
    }
  }
  if (warningSeconds > timeoutSeconds) {
    throw new Error('candidate-builder: warningSeconds must not exceed timeoutSeconds')
  }
  return timeoutSeconds === 0 ? undefined : { timeoutSeconds, warningSeconds }
}

export interface WorkerTimer {
  stop(): void
  snapshot(): WorkerTiming
}

/** Install before followup(), so even a fast first request cannot outrun the listener. */
export function installWorkerTimer(
  ctx: Context,
  child: Agent,
  options: ResolvedWorkerTimer,
  parentSignal: AbortSignal,
): WorkerTimer {
  let startedAt: number | undefined
  let deadline: number | undefined
  let startedMono = 0
  let elapsedSeconds = 0
  let stopped = false
  let timedOut = false
  let warningId: MessageId | undefined
  let warningAdmitted = false
  let turnSignal: AbortSignal | undefined
  let warningTimer: ReturnType<typeof setTimeout> | undefined
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  const disposers: (() => void)[] = []

  const elapsed = () => startedAt === undefined ? 0 : (performance.now() - startedMono) / 1000
  const remaining = () => Math.max(0, Math.ceil(options.timeoutSeconds - elapsed()))
  const stop = () => {
    if (stopped) return
    elapsedSeconds = elapsed()
    stopped = true
    clearTimeout(warningTimer)
    clearTimeout(expiryTimer)
    for (const dispose of disposers.splice(0)) dispose()
  }
  const active = () => !stopped && child.status === 'running'
    && !parentSignal.aborted && !turnSignal?.aborted
  const warning = () => createUserMessage({
    source: {
      kind: 'candidate-builder:timer',
      form: 'notice',
      summary: 'Worker time limit is approaching',
    },
    content: [{
      type: 'text',
      text: `HARD DEADLINE — IMMEDIATE ACTION REQUIRED. ONLY ${remaining()} SECONDS REMAIN `
        + `(deadline: ${new Date(deadline!).toISOString()}). `
        + 'STOP ALL CURRENT WORK IMMEDIATELY. '
        + 'NO MORE REASONING, ANALYSIS, PLANNING, EXPLORATION, TESTING, OR VERIFICATION. '
        + 'YOUR NEXT ACTION MUST BE A TOOL CALL THAT WRITES YOUR COMPLETE BEST-AVAILABLE SOLUTION TO THE SOLUTION FILE. '
        + 'DO NOT OUTPUT TEXT, EXPLANATIONS, OR ACKNOWLEDGMENTS BEFORE THAT TOOL CALL. '
        + 'DO NOT CALL ANY OTHER TOOL FIRST. '
        + 'USE ONLY THE INFORMATION AND CODE YOU ALREADY HAVE. '
        + 'IF YOUR SOLUTION IS INCOMPLETE, WRITE THE BEST WORKING VERSION IMMEDIATELY. '
        + 'PRIORITIZE SAVING A VALID SOLUTION OVER IMPROVING ITS QUALITY. '
        + 'ONLY AFTER THE FILE HAS BEEN SUCCESSFULLY WRITTEN MAY YOU USE ANY REMAINING TIME FOR IMPROVEMENTS. '
        + 'FAILURE TO WRITE THE FILE BEFORE THE DEADLINE MEANS IMMEDIATE CANCELLATION AND TOTAL LOSS OF UNSAVED WORK. '
        + 'ACT NOW. WRITE THE FILE. NO EXCEPTIONS.',
    }],
  })
  const expire = () => {
    if (!active()) { stop(); return }
    timedOut = true
    stop()
    child.cancel({ kind: 'hook', reason: `candidate-builder time limit exceeded (${options.timeoutSeconds}s)` })
  }
  const warn = () => {
    if (!active()) { stop(); return }
    if (remaining() === 0) { expire(); return }
    const message = warning()
    warningId = message.id
    child.steer(message)
  }

  disposers.push(ctx.on('agent/pre-step', async ({ signal }, next) => {
    if (turnSignal === undefined) {
      turnSignal = signal
      signal.addEventListener('abort', stop, { once: true })
      disposers.push(() => signal.removeEventListener('abort', stop))
    }
    const decision = await next()
    if (!active() || decision.kind !== 'enter') return decision
    if (startedAt !== undefined && remaining() === 0) { expire(); return decision }
    // A long model response or shell call can delay delivery. Refresh the same
    // identified message at admission without replacing other hooks' decisions.
    if (warningId === undefined || !decision.messages.some(message => message.id === warningId)) return decision
    warningAdmitted = true
    return {
      ...decision,
      messages: decision.messages.map(message => message.id === warningId ? { ...message, content: warning().content } : message),
    }
  }))
  // A queued warning enters only at a step boundary. End this worker's current
  // response with an ordinary stop, not a cancel, so the turn continues into a
  // step that admits it. Never cut inside a tool call or before any content.
  async function* endForWarning(stream: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
    const unsafe = new Set<number>()
    const closed = new Set<number>()
    let content = false
    for await (const chunk of stream) {
      yield chunk
      if (chunk.type === 'block-end') {
        unsafe.delete(chunk.index)
        closed.add(chunk.index)
        content ||= hasContent(chunk.block)
      } else if (chunk.type === 'block-start' || chunk.type === 'tool-call-delta') {
        const type = chunk.type === 'block-start' ? chunk.blockType : 'tool-call'
        if (type !== 'text' && type !== 'reasoning' && !closed.has(chunk.index)) unsafe.add(chunk.index)
      } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        content ||= chunk.text.trim() !== ''
      }
      if (warningId !== undefined && !warningAdmitted && active() && content && unsafe.size === 0) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
    }
  }
  disposers.push(ctx.on('llm/stream', (options, next) =>
    isAgentLoopRequest(options) && options.sessionId === child.session.id ? endForWarning(next()) : next()))
  disposers.push(ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.type !== 'start' || startedAt !== undefined || !active()) return
    startedAt = Date.now()
    startedMono = performance.now()
    deadline = startedAt + options.timeoutSeconds * 1000
    expiryTimer = setTimeout(expire, options.timeoutSeconds * 1000)
    if (options.warningSeconds > 0) {
      warningTimer = setTimeout(warn, (options.timeoutSeconds - options.warningSeconds) * 1000)
    }
  }))
  // Stop at the terminal log boundary too: 'running' can cover checkpoints
  // after turn/end. A warning must never wake a completed one-shot child.
  disposers.push(ctx.on('session/event', (session, event) => {
    if (session.id === child.session.id && event.type === 'turn/end') stop()
  }))
  disposers.push(ctx.on('agent/status', ({ status }) => { if (status === 'idle') stop() }))
  parentSignal.addEventListener('abort', stop, { once: true })
  disposers.push(() => parentSignal.removeEventListener('abort', stop))
  ctx.effect(() => stop)
  if (parentSignal.aborted) stop()

  return {
    stop,
    snapshot: () => ({
      ...options,
      ...(startedAt === undefined ? {} : { startedAt, deadline: deadline! }),
      elapsedSeconds: stopped ? elapsedSeconds : elapsed(),
      warningQueued: warningId !== undefined,
      timedOut,
    }),
  }
}

function hasContent(block: ContentBlock): boolean {
  return block.type === 'tool-call' || ((block.type === 'text' || block.type === 'reasoning') && block.text.trim() !== '')
}
