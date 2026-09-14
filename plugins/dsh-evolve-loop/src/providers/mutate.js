/**
 * Default mutate / variation provider: allocates candidate directory and spawns a worker subagent.
 * Supports all dirspawn configuration parameters (instruction, description, persona, model, allowShell, allowedTools).
 *
 * @module dsh-evolve-loop/providers/mutate
 */

export const name = 'dirspawn-worker'

/** Default worker persona. */
export function defaultPersona() {
  return 'You are an autonomous algorithm and code optimization engineer. Your goal is to inspect the solution in your workspace, understand the problem, and produce a higher-performing implementation.'
}

/**
 * Default worker task instruction with parent fitness feedback.
 * @param {number} [parentFitness] - fitness score of the parent solution.
 * @returns {string}
 */
export function defaultInstruction(parentFitness) {
  const lines = [
    'Inspect the current directory and understand the task.',
    'Examine the current solution implemented between the evolve markers (#EVOLVE_START and #EVOLVE_END).',
  ]

  if (typeof parentFitness === 'number' && Number.isFinite(parentFitness)) {
    lines.push(`This solution achieved a score of ${parentFitness}.`)
  }

  lines.push(
    'Think carefully and write a better solution between these markers to improve performance.',
    'Remove any temporary scratch files you create before finishing.',
  )

  return lines.join('\n')
}

/**
 * Produce a mutated candidate from a parent.
 * @param {object} options - configuration options.
 * @param {string} options.parent - parent candidate id (required).
 * @param {number} [options.parentFitness] - fitness score of the parent candidate.
 * @param {string} [options.instruction] - task instruction for the worker subagent.
 * @param {string} [options.description] - short label for the worker run.
 * @param {string} [options.persona] - persona instructions for the worker subagent.
 * @param {string} [options.model] - model id override for the worker.
 * @param {boolean} [options.allowShell=true] - whether shell tools are available to the worker.
 * @param {string[]} [options.allowedTools] - additional tool names granted to the worker.
 * @param {number} [options.maxDepth] - max delegation depth.
 * @param {object} evolve - the evolve service.
 * @returns {Promise<{ id: string, dir: string }>} the allocated candidate.
 */
export async function mutate(options, evolve) {
  const {
    parent,
    parentFitness: providedFitness,
    instruction: providedInstruction,
    description,
    persona = defaultPersona(),
    model,
    allowShell = true,
    allowedTools,
    maxDepth,
    ...extra
  } = options ?? {}

  if (!parent) throw new Error('mutate needs a parent candidate id')

  let parentFitness = providedFitness
  if (parentFitness === undefined && evolve?.population) {
    const rows = await evolve.population().rows()
    const parentRow = rows.find(r => r.id === parent)
    if (parentRow && typeof parentRow.fitness === 'number') {
      parentFitness = parentRow.fitness
    }
  }

  const instruction = providedInstruction ?? defaultInstruction(parentFitness)
  const candidate = await evolve.allocate(parent)
  const workerDescription = description ?? `Mutate candidate ${candidate.id}`

  try {
    await evolve.spawnWorker(candidate.dir, instruction, {
      description: workerDescription,
      persona,
      model,
      allowShell,
      allowedTools,
      maxDepth,
      ...extra,
    })
  } catch (error) {
    // If the run was canceled, rethrow to unwind immediately.
    const currentRun = evolve.currentRun?.()
    if (currentRun?.signal?.aborted) throw error
    // A failed worker leaves candidate files as is; it will still be evaluated.
  }

  return candidate
}

export default { name, mutate, defaultInstruction, defaultPersona }
