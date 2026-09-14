/**
 * Default evaluate provider: executes python evaluate.py with subprocess and timeout.
 *
 * @module dsh-evolve-loop/providers/evaluate
 */

import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'python-subprocess'

const STDOUT_MAX_BYTES = 1024 * 1024
const STDERR_MAX_BYTES = 64 * 1024
const GRACE_MS = 2000
const DEFAULT_TIMEOUT_MS = 60000

function lastLine(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  return lines[lines.length - 1] ?? ''
}

function parseScore(stdout) {
  const lines = stdout.split(/\r?\n/).filter(line => line.trim() !== '')
  // Scan backwards for JSON containing score/fitness
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    try {
      const obj = JSON.parse(line)
      if (typeof obj?.score === 'number' && Number.isFinite(obj.score)) return obj.score
      if (typeof obj?.fitness === 'number' && Number.isFinite(obj.fitness)) return obj.fitness
    } catch {
      // not json, continue
    }
  }
  // Try parsing last line directly as a float
  const last = lastLine(stdout)
  const num = Number(last)
  if (Number.isFinite(num)) return num
  return null
}

export async function evaluateSeed(candidateDir, seed, evolve) {
  const run = evolve.currentRun()
  const { task, agent, signal } = run
  const ctx = evolve.ctx

  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('the default evaluate needs the subprocess service')
  const python = await subprocess.resolveExecutable('python', undefined, signal)
  let argv = [python, '-B', join(task, 'evaluate.py'), '--candidate', candidateDir, '--seed', String(seed)]

  const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
  if (policy !== undefined && policy.mode !== 'danger-full-access') {
    const sandbox = ctx.get('sandbox')
    if (sandbox === undefined) throw new Error(`sandbox mode "${policy.mode}" needs the sandbox service`)
    argv = sandbox.confine(argv, { ...policy, workspaceRoot: await realpath(candidateDir) }).argv
  }

  // Combine parent signal with per-seed timeout
  const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) : undefined
  const effectiveSignal = timeoutSignal && AbortSignal.any ? AbortSignal.any([signal, timeoutSignal]) : signal

  const handle = subprocess.spawn({
    argv,
    cwd: task,
    stdio: { stdin: 'ignore', stdout: { maxBytes: STDOUT_MAX_BYTES }, stderr: { maxBytes: STDERR_MAX_BYTES } },
    graceMs: GRACE_MS,
    signal: effectiveSignal,
  })

  const outcome = await handle.done
  signal.throwIfAborted()

  const stdout = handle.collected.stdout.readFrom(0).text
  const stderr = handle.collected.stderr.readFrom(0).text

  const failed = detail => new Error(
    `evaluate.py failed on ${candidateDir} for seed ${String(seed)}: ${detail}`
    + (stderr.trim() === '' ? '' : `\n${stderr.trim().slice(-2000)}`),
  )

  if (outcome.exitCode !== 0) throw failed(`exit code ${String(outcome.exitCode ?? outcome.signal)}`)

  const score = parseScore(stdout)
  if (score === null) {
    throw failed(`no numeric score found in evaluator output:\n${stdout.slice(-1000)}`)
  }
  return score
}

export async function evaluate(candidate, evolve) {
  const { seeds } = await evolve.context()
  const run = evolve.currentRun()
  let sum = 0
  for (const seed of seeds) {
    run.signal.throwIfAborted()
    sum += await evaluateSeed(candidate.dir, seed, evolve)
  }
  return sum / seeds.length
}

export default { name, evaluate }
