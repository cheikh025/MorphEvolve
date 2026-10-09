/**
 * Default search loop provider: coordinates baseline evaluation, iterative variation,
 * scoring, recording, and survival. Returns { best_id, best_fitness, remaining }.
 * Up to WORKERS candidates are built at once; they are scored one at a time.
 *
 * @module dsh-evolve-loop/providers/loop
 */

import { alive, merit } from '../population.js'

export const name = 'evolve-loop'

/** How many workers build candidates at the same time. Scoring stays one at a time. */
export const WORKERS = 5

/**
 * Execute the evolutionary search loop.
 * @param {object} args - loop arguments (maxBudget, maxPopulation, k, candidates).
 * @param {object} evolve - the evolve service.
 * @returns {Promise<{ best_id: string, best_fitness: number, remaining: number }>}
 */
export async function run(args, evolve) {
  const { maxPopulation, candidates } = await evolve.context()
  const population = evolve.population()
  const runState = evolve.currentRun()

  // 1. Initialize baseline c000000 if population is empty
  let rows = await population.rows()
  if (rows.length === 0) {
    const base = await evolve.copyTask()
    const baseFitness = await evolve.evaluate(base)
    await population.append({
      id: base.id,
      parent: null,
      fitness: baseFitness,
      survival: 'yes',
    })
    rows = await population.rows()
  }

  // 2. Search: WORKERS slots each build one candidate at a time; a slot starts the next
  // one as soon as its candidate is recorded. Selection, scoring, recording and culling
  // run one at a time, in the order slots reach them.
  let launches = Math.min((await evolve.context()).budget.remaining, candidates ?? Infinity)
  let failure
  let turn = Promise.resolve()
  const inTurn = step => {
    const done = turn.then(step)
    turn = done.catch(() => {})
    return done
  }

  const slot = async () => {
    while (failure === undefined && launches > 0) {
      launches -= 1
      try {
        runState.signal.throwIfAborted()

        // Selection (the same parent may be picked by several slots)
        const parentId = await inTurn(() => evolve.select(population))

        // Mutation & Allocation, in parallel with the other slots
        const candidate = await evolve.mutate({ parent: parentId })

        // Evaluation, Recording and Survival culling, one candidate at a time
        await inTurn(async () => {
          runState.signal.throwIfAborted()
          const fitness = await evolve.evaluate(candidate)
          await population.append({
            id: candidate.id,
            parent: parentId,
            fitness,
            survival: 'yes',
          })
          if (alive(await population.rows()).length >= maxPopulation) {
            await evolve.survive(population)
          }
        })
      } catch (error) {
        // A mutate that allocated past the budget ends its slot; any other error ends the search.
        if (String(error?.message).startsWith('candidate budget exhausted')) return
        failure ??= error
      }
    }
  }

  // Wait for every slot, so no worker outlives the call
  await Promise.all(Array.from({ length: WORKERS }, slot))
  if (failure !== undefined) throw failure

  // 3. Determine best candidate overall (by merit: a failed evaluation never wins)
  rows = await population.rows()
  let best = rows[0]
  for (const row of rows) {
    if (best === undefined || merit(row.fitness) > merit(best.fitness)) {
      best = row
    }
  }

  const budget = (await evolve.context()).budget
  return {
    best_id: best?.id ?? 'c000000',
    best_fitness: best?.fitness ?? 0,
    remaining: budget.remaining,
  }
}

export default { name, run }
