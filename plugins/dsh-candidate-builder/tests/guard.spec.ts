import { expect, it } from 'vitest'
import { makeGuard } from '../src/index.ts'

const ROOT = '/work/run/candidates/c000001'
const call = (name: string, args: Record<string, unknown> = {}) =>
  makeGuard(ROOT)({ name, arguments: args } as never)

it('never lets a child use the shell', () => {
  expect(call('bash', { command: 'g++ solution.cpp' })).toMatch(/unavailable/)
  expect(call('pwsh', { command: 'dir', workdir: ROOT })).toMatch(/unavailable/)
})

it('keeps file tools inside the confined directory', () => {
  expect(call('read', { file_path: `${ROOT}/solution.cpp` })).toBeUndefined()
  expect(call('read', { file_path: '/work/run/population.jsonl' })).toMatch(/escapes/)
})
