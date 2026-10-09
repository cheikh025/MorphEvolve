/**
 * Candidates domain: manages candidate directory workspaces, isolation,
 * baseline creation, and child directory allocation.
 *
 * @module dsh-evolve-loop/candidates
 */

import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

export const CANDIDATES_DIR = 'candidates'
export const ABANDONED_DIR = 'abandoned'
export const BASELINE_ID = 'c000000'
export const RUN_DIR = 'run'

const CANDIDATE_NAME = /^c(\d{6})$/

/**
 * Format a candidate id from its ordinal number (e.g. 1 -> 'c000001').
 * @param {number} ordinal
 * @returns {string}
 */
export function candidateId(ordinal) {
  return `c${String(ordinal).padStart(6, '0')}`
}

/**
 * Resolve the workspace task path and the run root directory for the calling agent.
 * @param {object} agent - the calling orchestrator agent.
 * @returns {{ task: string, root: string }}
 */
export function runPaths(agent) {
  const task = agent?.session?.header?.cwd
  if (typeof task !== 'string' || !isAbsolute(task)) {
    throw new Error('dsh-evolve-loop: the calling agent has no absolute workspace to run in')
  }
  return { task, root: join(task, RUN_DIR) }
}

/**
 * Return the absolute filesystem path for a candidate directory.
 * @param {string} runDir - the run root directory.
 * @param {string} id - candidate id (e.g. 'c000001').
 * @returns {string}
 */
export function candidatePath(runDir, id) {
  return join(runDir, CANDIDATES_DIR, id)
}

/**
 * Enumerate all existing candidate directory ordinal numbers.
 * @param {string} runDir - the run root directory.
 * @param {string} [dirName=CANDIDATES_DIR] - the folder under runDir to enumerate.
 * @returns {Promise<number[]>}
 */
export async function candidateOrdinals(runDir, dirName = CANDIDATES_DIR) {
  let entries
  try {
    entries = await readdir(join(runDir, dirName), { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter(entry => entry.isDirectory() && CANDIDATE_NAME.test(entry.name))
    .map(entry => Number(CANDIDATE_NAME.exec(entry.name)[1]))
}

/**
 * Move candidates that were allocated but never recorded (left over by a stopped run call)
 * from candidates/ to abandoned/, so they spend no budget. Call it only while no worker is
 * running. Their ids stay taken: allocation numbers past them.
 * @param {string} runDir - the run root directory.
 * @param {Iterable<string>} recordedIds - ids recorded in population.jsonl.
 * @returns {Promise<string[]>} the ids moved.
 */
export async function retireLeftovers(runDir, recordedIds) {
  const recorded = new Set(recordedIds)
  const leftovers = (await candidateOrdinals(runDir))
    .filter(ordinal => ordinal >= 1)
    .map(candidateId)
    .filter(id => !recorded.has(id))
  if (leftovers.length > 0) await mkdir(join(runDir, ABANDONED_DIR), { recursive: true })
  for (const id of leftovers) {
    await rename(candidatePath(runDir, id), join(runDir, ABANDONED_DIR, id))
  }
  return leftovers
}

/**
 * Check whether a candidate directory physically exists on disk.
 * @param {string} runDir - the run root directory.
 * @param {unknown} id - candidate id.
 * @returns {Promise<boolean>}
 */
export async function isCandidate(runDir, id) {
  if (typeof id !== 'string' || !CANDIDATE_NAME.test(id)) return false
  try {
    return (await stat(candidatePath(runDir, id))).isDirectory()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Create baseline c000000 by copying the task workspace. The evaluator and its settings
 * (evaluator/, task.json) stay at the task root, out of the worker's reach; run/ and
 * __pycache__ are not copied either.
 * @param {string} runDir - the run root directory.
 * @param {string} taskDir - the task workspace directory.
 * @returns {Promise<{ id: string, path: string }>}
 */
export async function copyTask(runDir, taskDir) {
  const destination = candidatePath(runDir, BASELINE_ID)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  const skip = name => [RUN_DIR, '__pycache__', 'evaluator', 'task.json'].includes(name)
  for (const name of await readdir(taskDir)) {
    if (skip(name)) continue
    await cp(join(taskDir, name), join(destination, name), {
      recursive: true,
      filter: source => basename(source) !== '__pycache__',
    })
  }
  return { id: BASELINE_ID, path: destination }
}

/**
 * Atomically allocate a new candidate directory from a parent candidate,
 * validating that the attempt budget has not been exhausted.
 * @param {string} runDir - the run root directory.
 * @param {number} maxBudget - total allowed new candidate attempts.
 * @param {string} parentId - parent candidate id to copy.
 * @returns {Promise<{ id: string, path: string, used: number, remaining: number }>}
 */
export async function allocateCandidate(runDir, maxBudget, parentId) {
  const source = candidatePath(runDir, parentId)
  await mkdir(join(runDir, CANDIDATES_DIR), { recursive: true })

  for (;;) {
    const taken = await candidateOrdinals(runDir)
    const used = taken.filter(ordinal => ordinal >= 1).length
    if (used >= maxBudget) {
      throw new Error(`candidate budget exhausted: ${String(used)} of ${String(maxBudget)} attempts used`)
    }
    const abandoned = await candidateOrdinals(runDir, ABANDONED_DIR)
    const id = candidateId(Math.max(0, ...taken, ...abandoned) + 1)
    const destination = candidatePath(runDir, id)
    try {
      // Exclusive mkdir to prevent concurrent race conditions
      await mkdir(destination)
    } catch (error) {
      if (error.code === 'EEXIST') continue
      throw error
    }
    await cp(source, destination, { recursive: true })
    return { id, path: destination, used: used + 1, remaining: Math.max(0, maxBudget - used - 1) }
  }
}
