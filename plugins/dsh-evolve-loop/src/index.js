/**
 * The EVOLVE search plugin: provides the `evolve` service and the model-facing `evolve_run` tool.
 *
 * Exposes swappable service providers on ctx.evolve ('loop' / 'evolve-loop', 'select', 'mutate', 'evaluate', 'survive').
 *
 * @module dsh-evolve-loop
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { budgetReport } from './budget.js'
import { runPaths } from './candidates.js'
import { Evolve, DEFAULT_MAX_POPULATION, DEFAULT_K } from './evolve.js'

export const name = 'dsh-evolve-loop'
export const inject = ['tools', 'subagents']

/**
 * Provide the `evolve` service and register `evolve_run` and `evolve_status`.
 * @param {object} ctx - the plugin context.
 */
export function apply(ctx) {
  const evolve = new Evolve(ctx)
  ctx.provide('evolve', evolve)

  ctx.tools.register(defineTool({
    name: 'evolve_run',
    description:
      'Run the evolutionary search on the task in your working directory, and wait until it stops. '
      + 'Its state lives in run/ inside the task. When the population is empty, the baseline c000000 is created, '
      + 'evaluated and recorded without spending budget. Each search iteration selects a parent, generates a new '
      + 'candidate, evaluates it over the official seeds, records it in population.jsonl, and culls excess candidates. '
      + 'Returns the best candidate ID, its fitness, and remaining budget: { best_id, best_fitness, remaining }. '
      + 'All search components (evolve-loop, select, mutate, evaluate, survive) are swappable via ctx.evolve.register().',
    parameters: {
      max_budget: {
        type: 'integer',
        required: true,
        description: 'Total number of new candidates for the whole run, from the user\'s instruction.',
      },
      max_population: {
        type: 'integer',
        description: `How many alive candidates the population may hold before it is culled. Default ${DEFAULT_MAX_POPULATION}.`,
      },
      seeds: {
        type: 'array',
        items: { type: 'integer' },
        required: true,
        description: 'The official seeds every candidate is scored on, from the user\'s instruction.',
      },
      k: {
        type: 'integer',
        description: `How many candidates a cull keeps. Default ${DEFAULT_K}.`,
      },
      candidates: {
        type: 'integer',
        description: 'The most new candidates this call may create. Default: until the budget is used.',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        if (value && typeof value.best_id === 'string' && typeof value.best_fitness === 'number') {
          return [{
            type: 'text',
            text: `Best candidate ${value.best_id} (fitness ${value.best_fitness}); ${value.remaining} of budget remaining.`,
          }]
        }
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args, exec) {
      const result = await evolve.run({
        maxBudget: args.max_budget,
        ...(args.max_population === undefined ? {} : { maxPopulation: args.max_population }),
        seeds: args.seeds,
        ...(args.k === undefined ? {} : { k: args.k }),
        ...(args.candidates === undefined ? {} : { candidates: args.candidates }),
      }, exec)
      return result ?? null
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_status',
    description:
      'Read-only: show the providers and the budget of the evolve search, without running anything. '
      + '`providers` lists, for each step (loop, select, mutate, evaluate, survive), the provider names stacked in that '
      + 'slot from bottom to top; the last name is the active one. Providers belong to this DSH process. '
      + '`budget` is the candidate budget of the task in your working directory: { max, used, remaining }; null before '
      + 'the first evolve_run on this task; { error } if it cannot be read. For the population, read run/population.jsonl.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'Read evolve status', kind: 'read' }),
    async execute(_args, exec) {
      const { task, root } = runPaths(exec.agent)
      let budget
      try {
        budget = await budgetReport(root)
      } catch (error) {
        budget = { error: error instanceof Error ? error.message : String(error) }
      }
      return { task, providers: evolve.providerStacks(), budget }
    },
  }))
}
