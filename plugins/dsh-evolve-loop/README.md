# dsh-evolve-loop

Swappable evolutionary search plugin for DeepSeek Harness (DSH). Provides the `evolve` capability seam on Cordis context (`ctx.evolve`) and the model-facing `evolve_run` tool.

## Architecture: Modular Capability Seam

The search is decomposed into modular Service Providers coordinated by the `evolve` service:

1. **`evolve-loop` (`loop`)**: Coordinates iteration cycles, baseline handling, budget consumption, and termination.
2. **`select`**: Selects parent candidate(s) from alive population (default: fitness-proportional roulette wheel).
3. **`mutate`**: Manages candidate generation, directory allocation, and worker subagent variation (default: `dirspawn` subagent).
4. **`evaluate`**: Scores a candidate with the task's evaluator, `evaluate(program_path)` in `<task>/evaluator/evaluator.py`, following SkyDiscover's evaluator: the task's timeout and retries from `<task>/task.json`, fitness from `combined_score`. The full result is kept in `run/evals/<id>.json` (default: `src/providers/run_evaluator.py` in a `python` subprocess).
5. **`survive`**: Population capacity management and culling (default: top-k retention, default k=5).

## Domain Persistence Modules

Instead of a monolithic disk store, on-disk state is partitioned strictly by domain responsibility:

- **`src/population.js`**: Owns `population.jsonl`. Reads records, handles parent lineage, performs atomic crash-safe rewrites during culling, and tracks alive candidates.
- **`src/budget.js`**: Owns `budget.json`. Pins run budgets, counts spent attempts from candidate folders, and tracks remaining units.
- **`src/candidates.js`**: Owns candidate workspaces (`candidates/c000000`, `candidates/c000001`). Copies the task baseline, allocates child directories, and manages path resolution.
- **`src/files.js`**: Owns raw file I/O for machinery state under the run directory. `evolve.files` exposes `resolve`, `write` (atomic), `append`, `read`, `list`, `exists` and `remove` on paths confined to `run/`. Dynamic (sandboxed) provider code must use it instead of `node:fs` (absent in the sandbox) or `ctx.fs` (policy-fenced without a caller session, so writes under `run/` fail with `FS_SANDBOX_DENIED`); this module runs in the plugin's host half, which has neither restriction.

## Inspecting and Swapping Providers at Runtime

Any Cordis dynamic plugin or preset can inspect the active providers:

```javascript
const providers = ctx.evolve.listProviders()
// {
//   loop: "evolve-loop",
//   select: "fitness-proportional",
//   mutate: "dirspawn-worker",
//   evaluate: "python-subprocess",
//   survive: "top-k"
// }
```

### Swapping a Provider

To swap selection to tournament selection, an agent can activate a dynamic plugin:

```javascript
export const name = 'custom-tournament-selection'
export const inject = ['evolve']

export function apply(ctx) {
  ctx.effect(() => {
    return ctx.evolve.register('select', {
      name: 'tournament-selection',
      async select(population, evolve) {
        const rows = await population.rows()
        const alive = rows.filter(r => r.survival === 'yes')
        // Custom tournament logic...
        return winnerId
      }
    })
  })
}
```

When the plugin is unloaded or reloaded, Cordis automatically invokes the disposer and restores the previous provider!

## Tool Interface: `evolve_run`

The `evolve_run` tool takes:
- `max_budget`: Total new candidate budget for the entire run (required).
- `max_population` (optional): Population capacity before triggering `survive` (default 10).
- `k` (optional): Survivors to keep during culling (default 5).
- `candidates` (optional): Max candidates to create in this invocation.

### Return Payload

The tool returns a strictly concise, high-signal payload to the LLM to preserve context window economy:

```json
{
  "best_id": "c000004",
  "best_fitness": 92.5,
  "remaining": 7
}
```

Rendered text:
`Best candidate c000004 (fitness 92.5); 7 of budget remaining.`

## On-Disk State (`<task>/run/`)

```text
<task>/run/
├── budget.json          # { "max": 50 }
├── population.jsonl     # {"id":"c000001","parent":"c000000","fitness":85.0,"survival":"yes"}
├── evals/
│   └── c000001.json     # {"fitness": 85.0, "metrics": {...}}: the evaluator's full result
└── candidates/
    ├── c000000/         # Baseline copy of task, without evaluator/ and task.json (0 budget)
    ├── c000001/         # Attempt 1 (1 budget)
    └── ...
```
