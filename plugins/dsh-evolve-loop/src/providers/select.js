/**
 * Default parent selection provider: fitness-proportional roulette-wheel selection.
 *
 * @module dsh-evolve-loop/providers/select
 */

import { alive } from '../population.js'

export const name = 'fitness-proportional'

// A minimize task's evaluator makes its scores negative (lower is better), so those weigh 1/|fitness|.
const weight = fitness => (fitness > 0 ? fitness : fitness < 0 ? -1 / fitness : 0)

/**
 * Select a parent candidate from the alive population.
 * @param {object} population - the population handle.
 * @param {object} evolve - the evolve service.
 * @returns {Promise<string>} selected candidate ID.
 */
export async function select(population, evolve) {
  const rows = await population.rows()
  const pool = alive(rows)
  if (pool.length === 0) {
    throw new Error('the population has no alive candidate to select')
  }

  const total = pool.reduce((sum, row) => sum + weight(row.fitness), 0)
  if (total > 0) {
    let ticket = Math.random() * total
    for (const row of pool) {
      ticket -= weight(row.fitness)
      if (ticket <= 0) return row.id
    }
    return pool[pool.length - 1].id
  }

  // Uniform when every weight is 0: every alive candidate scored 0
  return pool[Math.floor(Math.random() * pool.length)].id
}

export default { name, select }
