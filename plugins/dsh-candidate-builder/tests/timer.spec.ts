import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installWorkerTimer, resolveWorkerTimer } from '../src/timer.ts'

// Model the public event boundary. No live model calls or real ten-minute waits.
function worker(timeoutSeconds = 600, warningSeconds = 60) {
  const listeners = new Map<string, Set<(...args: any[]) => any>>()
  const cleanups: (() => void)[] = []
  const parent = new AbortController()
  const turn = new AbortController()
  const child = {
    status: 'idle',
    session: {
      id: 'worker',
      append: vi.fn(),
    },
    steer: vi.fn(),
    cancel: vi.fn((cause) => turn.abort(cause)),
  }
  const ctx = {
    on(name: string, fn: (...args: any[]) => any) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      set.add(fn)
      return () => { set.delete(fn) }
    },
    effect(fn: () => () => void) { cleanups.push(fn()) },
  }
  const emit = (name: string, ...args: any[]) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args)
  }
  const timer = installWorkerTimer(ctx as never, child as never, { timeoutSeconds, warningSeconds }, parent.signal)
  async function step(messages: any[] = [], override?: any) {
    const hook = [...(listeners.get('agent/pre-step') ?? [])][0]
    const decision = override ?? { kind: 'enter', messages }
    return hook ? await hook({ signal: turn.signal }, async () => decision) : decision
  }
  async function start() {
    child.status = 'running'
    await step()
    emit('agent/assistant-stream', { frame: { type: 'start' } })
  }
  return { child, parent, turn, timer, emit, step, start, dispose: () => cleanups.forEach(fn => fn()) }
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }))
afterEach(() => vi.useRealTimers())

describe('worker timer settings', () => {
  it('defaults to ten minutes with a two-minute warning, and zero disables it', () => {
    expect(resolveWorkerTimer({})).toEqual({ timeoutSeconds: 600, warningSeconds: 120 })
    expect(resolveWorkerTimer({ timeoutSeconds: 0 })).toBeUndefined()
    expect(resolveWorkerTimer({ timeoutSeconds: 900 })).toEqual({ timeoutSeconds: 900, warningSeconds: 120 })
    expect(resolveWorkerTimer({ timeoutSeconds: 10 })).toEqual({ timeoutSeconds: 10, warningSeconds: 10 })
    expect(resolveWorkerTimer({ warningSeconds: 60 })).toEqual({ timeoutSeconds: 600, warningSeconds: 60 })
  })
  it.each([-1, 0.5, NaN, Infinity, 2_147_484])('rejects invalid duration %s', value => {
    expect(() => resolveWorkerTimer({ timeoutSeconds: value })).toThrow()
    expect(() => resolveWorkerTimer({ timeoutSeconds: 600, warningSeconds: value })).toThrow()
  })
  it('rejects warnings outside the budget, including a warning on a disabled timer', () => {
    expect(() => resolveWorkerTimer({ timeoutSeconds: 10, warningSeconds: 11 })).toThrow(/must not exceed/)
    expect(() => resolveWorkerTimer({ timeoutSeconds: 0, warningSeconds: 60 })).toThrow(/must not exceed/)
    expect(() => resolveWorkerTimer({ warningSeconds: 601 })).toThrow(/must not exceed/)
  })
})

describe('worker timing lifecycle', () => {
  it('excludes setup and starts only on the first model attempt, without resetting on later attempts', async () => {
    const w = worker()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(w.timer.snapshot().startedAt).toBeUndefined()
    w.child.status = 'running'
    await w.step()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(w.timer.snapshot().startedAt).toBeUndefined()
    await w.start()
    await vi.advanceTimersByTimeAsync(300_000)
    w.emit('agent/assistant-stream', { frame: { type: 'start' } })
    await vi.advanceTimersByTimeAsync(240_000)
    expect(w.child.steer).toHaveBeenCalledTimes(1)
    expect(w.child.steer.mock.calls[0]![0].content[0].text).toContain('ONLY 60 SECONDS REMAIN')
    expect(w.child.cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(w.child.cancel).toHaveBeenCalledWith({ kind: 'hook', reason: expect.stringContaining('600s') })
    expect(w.parent.signal.aborted).toBe(false)
    expect(w.timer.snapshot()).toMatchObject({ timedOut: true, elapsedSeconds: 600, warningQueued: true })
    // Plugin events would make the stored session log unreadable on reload.
    expect(w.child.session.append).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes a warning delayed by a shell command while preserving its identity and downstream decision', async () => {
    const w = worker()
    await w.start()
    await vi.advanceTimersByTimeAsync(540_000)
    const queued = w.child.steer.mock.calls[0]![0]
    await vi.advanceTimersByTimeAsync(20_000)
    const other = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'other input' }] })
    const decision = await w.step([], { kind: 'enter', messages: [other, queued], startsRequestSeries: true })
    expect(decision.startsRequestSeries).toBe(true)
    expect(decision.messages[0]).toBe(other)
    expect(decision.messages[1].id).toBe(queued.id)
    expect(decision.messages[1].content[0].text).toContain('ONLY 40 SECONDS REMAIN')
    expect(queued.content[0].text).toContain('ONLY 60 SECONDS REMAIN')
    expect(await w.step([], { kind: 'reject' })).toEqual({ kind: 'reject' })
    w.dispose()
  })

  it('expires even if the model or shell never reaches another step', async () => {
    const w = worker(10, 1)
    await w.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(w.child.cancel).toHaveBeenCalledTimes(1)
    expect(w.timer.snapshot().timedOut).toBe(true)
  })

  it.each(['turn/end', 'idle', 'parent-abort', 'turn-abort', 'dispose'])('cleans up on %s and never revives a stopped worker', async reason => {
    const w = worker()
    await w.start()
    await vi.advanceTimersByTimeAsync(2000)
    if (reason === 'turn/end') w.emit('session/event', w.child.session, { type: 'turn/end' })
    if (reason === 'idle') w.emit('agent/status', { status: 'idle' })
    if (reason === 'parent-abort') w.parent.abort()
    if (reason === 'turn-abort') w.turn.abort()
    if (reason === 'dispose') w.dispose()
    await vi.advanceTimersByTimeAsync(1_000_000)
    expect(w.child.steer).not.toHaveBeenCalled()
    expect(w.child.cancel).not.toHaveBeenCalled()
    expect(w.timer.snapshot()).toMatchObject({ timedOut: false, elapsedSeconds: 2 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start after cancellation during setup', async () => {
    const w = worker()
    w.parent.abort()
    await w.start()
    await vi.advanceTimersByTimeAsync(1_000_000)
    expect(w.timer.snapshot().startedAt).toBeUndefined()
    expect(w.child.cancel).not.toHaveBeenCalled()
  })

  it('keeps deadlines independent across parallel workers', async () => {
    const a = worker(10, 1)
    const b = worker(10, 1)
    await a.start()
    await vi.advanceTimersByTimeAsync(5000)
    await b.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(a.child.cancel).toHaveBeenCalledTimes(1)
    expect(b.child.cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(b.child.cancel).toHaveBeenCalledTimes(1)
  })

  it('supports a deadline without a warning', async () => {
    const w = worker(10, 0)
    await w.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(w.child.steer).not.toHaveBeenCalled()
    expect(w.timer.snapshot()).toMatchObject({ timedOut: true, warningQueued: false })
  })
})
