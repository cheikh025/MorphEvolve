import { expect, it } from 'vitest'
import { makeGuard } from '../src/index.ts'

const ROOT = '/work/run/candidates/c000001'
const call = (name: string, args: Record<string, unknown> = {}) =>
  makeGuard(ROOT)({ name, arguments: args } as never)

it('allows shell tools by default on the shell branch', () => {
  expect(call('bash', { command: 'g++ solution.cpp' })).toBeUndefined()
  expect(call('pwsh', { command: 'dir', workdir: ROOT })).toBeUndefined()
})

it('denies shell tools when explicitly disabled', () => {
  const guard = makeGuard(ROOT, false)
  expect(guard({ name: 'bash', arguments: { command: 'g++ solution.cpp' } } as never)).toMatch(/unavailable/)
  expect(guard({ name: 'pwsh', arguments: { command: 'dir' } } as never)).toMatch(/unavailable/)
})

it('keeps file tools inside the confined directory', () => {
  expect(call('read', { file_path: `${ROOT}/solution.cpp` })).toBeUndefined()
  expect(call('read', { file_path: '/work/run/population.jsonl' })).toMatch(/escapes/)
})
