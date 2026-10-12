import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/tool.ts'

let ctx: Context
let start: ReturnType<typeof vi.fn>
let dispose: ReturnType<typeof vi.fn>
let childResult: any
let background: any
let fs: any
const timing = { timeoutSeconds: 600, warningSeconds: 60, elapsedSeconds: 600, warningQueued: true, timedOut: true }

beforeEach(async () => {
  ctx = new Context()
  dispose = vi.fn(async () => {})
  childResult = { output: [{ type: 'text', text: 'partial report' }], stopReason: 'aborted', timing,
    diagnostic: 'candidate-builder time limit exceeded (600s); candidate files were preserved' }
  start = vi.fn(async () => ({ id: 'child', result: Promise.resolve(childResult), dispose }))
  fs = { resolve: vi.fn(async () => '/work/candidate'), stat: async () => ({ type: 'directory' }), processPath: () => '/work/candidate' }
  background = undefined
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  await ctx.plugin({ name: 'test-services', apply(scope: Context) {
    scope.provide('subagents', { start } as never)
    scope.provide('jobs', { start(spec: any) { background = spec.run(); return 'job-1' } } as never)
  } })
  await ctx.plugin(plugin)
})
afterEach(async () => { await ctx.fiber.dispose() })

function call(args: Record<string, unknown>) {
  return ctx.tools.get('candidate-builder')!.execute({ directory: '.', prompt: 'write solution', ...args }, {
    agent: { session: { header: { cwd: '/work' } }, ctx: { get: () => fs } },
    signal: new AbortController().signal,
  } as never) as Promise<any>
}

it('forwards the settings and returns timeout metadata plus partial output after disposal', async () => {
  const result = await call({ timeout_seconds: 600, warning_seconds: 60, allow_shell: true })
  expect(start.mock.calls[0]![1]).toMatchObject({ timeoutSeconds: 600, warningSeconds: 60, confine: { allowShell: true } })
  expect(result).toMatchObject({ stopReason: 'aborted', timing, output: childResult.output })
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('applies the ten-minute default and forwards an explicit disable as 0', async () => {
  childResult = { output: [], stopReason: 'completed' }
  await call({})
  await call({ timeout_seconds: 0 })
  expect(start.mock.calls[0]![1]).toMatchObject({ timeoutSeconds: 600, warningSeconds: 120 })
  expect(start.mock.calls[1]![1]).toMatchObject({ timeoutSeconds: 0 })
  expect(start.mock.calls[1]![1]).not.toHaveProperty('warningSeconds')
})

it('rejects invalid settings before looking up files or starting a background job', async () => {
  await expect(call({ timeout_seconds: 20, warning_seconds: 30, run_in_background: true })).rejects.toThrow(/must not exceed/)
  expect(fs.resolve).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
  expect(background).toBeUndefined()
})

it('reports a background timeout using the provider diagnostic', async () => {
  expect(await call({ timeout_seconds: 600, run_in_background: true })).toMatchObject({ jobId: 'job-1' })
  expect(await background.done).toMatchObject({ status: 'failed', detail: expect.stringContaining('time limit exceeded') })
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('preserves a disposal failure instead of hiding it behind a timeout', async () => {
  dispose.mockRejectedValue(new Error('dispose failed'))
  await expect(call({ timeout_seconds: 600 })).rejects.toThrow('dispose failed')
})

it('keeps ordinary parent cancellation distinct from expiry', async () => {
  childResult = { output: [], stopReason: 'aborted' }
  await expect(call({ timeout_seconds: 600 })).rejects.toThrow('cancelled')
})
