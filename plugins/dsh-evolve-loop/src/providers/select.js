/**
 * Default parent selection provider: fitness-proportional roulette-wheel selection.
 *
 * @module dsh-evolve-loop/providers/select
 */

import { alive } from '../population.js'

export const name = 'fitness-proportional'

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

  const total = pool.reduce((sum, row) => sum + (row.fitness > 0 ? row.fitness : 0), 0)
  if (total > 0) {
    let ticket = Math.random() * total
    for (const row of pool) {
      const weight = row.fitness > 0 ? row.fitness : 0
      ticket -= weight
      if (ticket <= 0) return row.id
    }
    return pool[pool.length - 1].id
  }

  // Uniform fallback when no candidate has positive fitness
  return pool[Math.floor(Math.random() * pool.length)].id
}

export default { name, select }
