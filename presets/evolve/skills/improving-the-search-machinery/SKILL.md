---
name: improving-the-search-machinery
description: Use only when the search itself has stopped producing — the best fitness has not moved across several consecutive candidates, selection keeps returning the same parent, or the population has collapsed to near-identical entries. This is for replacing the search's providers, not for improving a candidate. Do not load it after a single disappointing candidate.
---

# Improving the search machinery

This is about changing how the search works, not about making a candidate better. Making a candidate better is the `mutate` step of the loop, and it is a worker's job. If that is what you need, you are in the wrong skill.

## Before you change anything

Rewriting the search costs a turn that produces no candidate, and a working loop is worth more than a theoretically better one. Three questions first, in order.

**Is there actually a problem?** One weak candidate is variance. So are two. As a starting point — advice, not a rule — do not consider a rewrite before the best fitness has failed to move across several consecutive candidates, and never on the basis of one. If you cannot say what the population has been doing over its recent history, you do not yet know whether anything is wrong.

**Is it the policy, or the candidates?** A stalled best score can mean selection keeps picking exhausted parents, or it can mean the workers are producing weak children from good ones. Those have opposite fixes. Read the population before deciding which you are looking at.

Ask what appears to be limiting progress. For example:

* Are promising candidates being selected poorly?
* Are improvement attempts repeatedly producing the same kinds of changes?
* Has the population lost useful diversity?
* Are workers receiving insufficient context or feedback?
* Is the improvement process failing to exploit good candidates or explore alternatives?
* Are useful results from previous attempts being forgotten?
* Are tools, models, or compute being allocated poorly?
* Is the workflow spending too much budget on low-value attempts?
* Is the search using the wrong signals to decide what to try next?

These are examples, not a checklist. The problem may be somewhere else entirely. Use the evidence available from the run to decide what, if anything, should change.

## Anything about the search process may be reconsidered

The initial search loop and its providers are starting policies, not boundaries on what the search may become.

You may modify existing search machinery, replace it, compose it differently, or create new machinery when useful.

Examples include changing:

* **Selection** — how parents, candidates, or directions are chosen.
* **Population management** — survival, archives, diversity, niches, restarts, or how search history is organized.
* **Improvement strategy** — refinement, exploration, repair, crossover, competing proposals, multi-stage improvement, or other ways of producing candidates.
* **Subagents** — how many are used, their roles, personas, models, tools, permissions, prompts, context, and how they interact. You may create new skills for particular subagents when specialized instructions or capabilities would improve the search.
* **Prompts and instructions** — what workers are told, what examples or feedback they receive, and how improvement instructions themselves are generated.
* **Tools** — which tools exist, which workers receive them, or new tools you create because the search needs capabilities it currently lacks.
* **Memory and context** — fresh or continued sessions, summaries, lessons, previous attempts, candidate history, retrieved information, or other forms of useful state.
* **Workflow and control flow** — sequential or parallel work, branching, retries, review stages, planning, verification, backtracking, or other coordination structures.
* **Search-time feedback** — additional measurements, proxy metrics, diagnostics, comparisons, or predictions used to guide the search.
* **Resource allocation** — which models or workers handle which work, how much effort different candidates receive, and when work happens concurrently.
* **Scheduling and adaptation** — when to explore, exploit, retry, abandon a direction, revisit an older candidate, or change strategy.
* **Stopping behavior** — how the remaining budget should be used and when continuing a particular line of search is no longer worthwhile.
* **The search strategy itself** — the search does not have to remain the same kind of evolutionary loop with which it started.

These are **examples of possibilities, not the definition of what you are allowed to change**. If you identify another part of the search process that is limiting progress, you may change or build that too.

## Preserve the fixed boundaries

Improving the search does not permit changing what defines a valid solution or a valid result.

You must not change:

* the task's evaluator (`evaluator/`) or its settings (`task.json`);
* the instances and test data the evaluator scores with;
* the definition of official fitness;
* the candidate budget, or the operations that create candidates — `allocate` and `copyTask`;
* the allowed editable regions of candidate solutions;
* an already recorded candidate, whose recorded score must continue to correspond to exactly the code that was evaluated.

Never create a candidate directory yourself. A directory that `allocate` or `copyTask` did not create is not a candidate, and may not be scored as one, recorded in the population, or returned as the final solution.

Search-time heuristics, proxies, intermediate evaluations, or other signals may guide your decisions, but they do not replace official fitness when determining the final best candidate.

A change that bypasses these boundaries has not improved the search; it has invalidated the run.

## Change the machinery you actually need

Do not assume the solution is to replace an existing provider.

You may inspect the current runtime, replace a provider, create a new tool, create a skill, change how subagents are invoked, or construct a larger workflow if that is what the diagnosis calls for.

When changing runtime components, inspect their current behavior and interfaces before modifying them. Use the available Cordis creator capabilities to inspect, define, activate, replace, or remove runtime components.

Load `cordis-plugin-development` when you need to create or modify Cordis plugins rather than guessing their interfaces.

### The `evolve` service

`evolve_run` runs the search through the `evolve` service. The service comes from the `dsh-evolve-loop` plugin, installed in the DSH profile — not in the harness checkout — at `${DSH_HOME:-$HOME/.dsh}/profiles/<profile>/node_modules/dsh-evolve-loop/`, with the service in `src/evolve.js` and the default providers in `src/providers/`.

The search is split into five slots, each filled by one active provider:

| slot | default provider | method | returns |
| --- | --- | --- | --- |
| `loop` | `evolve-loop` | `run(args, evolve)` | anything; the default returns `{ best_id, best_fitness, remaining }` |
| `select` | `fitness-proportional` | `select(population, evolve)` | the parent's candidate id |
| `mutate` | `dirspawn-worker` | `mutate({ parent }, evolve)` | the new candidate `{ id, dir }` |
| `evaluate` | `python-subprocess` | `evaluate(candidate, evolve)` | the candidate's fitness, a number |
| `survive` | `top-k` | `survive(population, evolve)` | nothing; it rewrites the survival flags |

Every method receives the service as `evolve`. These operations on it are fixed, and a provider may call them — but only while `evolve_run` is executing:

- `allocate(parentId)` — creates the next candidate as a full copy of the parent and spends one budget unit; returns `{ id, dir }`, and refuses when the budget is used up.
- `copyTask()` — creates the baseline `c000000`; returns `{ id, dir }`.
- `population()` — the run's population file: `rows()`, `append(row)`, `write(rows)`.
- `files` — a run-scoped file store for machinery state: `resolve(path)`, `write(path, text)`, `append(path, text)`, `read(path)` (undefined when absent), `list(dir)`, `exists(path)`, `remove(path)`. Paths are relative to the run directory (`run/`) and cannot escape it.
- `context()` — `{ task, root, k, maxPopulation, candidates, budget: { max, used, remaining } }`.
- `spawnWorker(dir, prompt, options)` — starts one worker confined to `dir` and waits for it; returns `{ text, stopReason }`. `options` may set `description`, `persona`, `model`, `allowShell`, `allowedTools` and `maxDepth`.

Persist machinery state (scores, reports, logs, digests) with `evolve.files`, never with `node:fs` or `ctx.fs`. The dynamic sandbox has no `node:fs`, and `ctx.fs` is policy-fenced: a dynamic plugin calls `writeText` without a per-call sandbox policy, so the fence resolves the deployment default policy (`workspace-write`, workspace root `process.cwd()`) and a write under the run directory fails with `FS_SANDBOX_DENIED`. The `evolve.files` handle runs in the plugin's host half, which has no such fence.

Before replacing anything, look at what is active: `evolve.listProviders()` returns the active provider's name for every slot, and `evolve.getProvider(slot)` returns the provider itself. The default mutate exposes `defaultInstruction(parentFitness)` and `defaultPersona()`, so you can read exactly what workers are told today.

### Replacing a provider

Register a provider from a dynamic plugin, inside `ctx.effect`, so that stopping the plugin removes it:

```js
return {
  apply(ctx) {
    const evolve = ctx.get('evolve')
    if (evolve === undefined) return
    ctx.effect(() => evolve.register('select', {
      name: 'tournament',
      async select(population, evolve) {
        const alive = (await population.rows()).filter(row => row.survival === 'yes')
        // choose one of `alive` and return its id
      },
    }))
  },
}
```

Define it with `cordis_define` and activate it with `cordis_run`. The newest registration for a slot is the active one, and the next `evolve_run` call uses it. `cordis_stop` removes it, and the provider that was active before comes back.

### Rules the service does not enforce

Nothing checks these, so a provider you write must keep them:

- **A mutate or loop you write must create every new candidate with `allocate`.** The loop stops when the budget is used up. A mutate that never calls `allocate` never spends budget, so without a `candidates` limit the loop never stops — and every pass still pays for a worker and a full evaluation.
- **A mutate must return the candidate it just allocated**, never an existing or already recorded one.
- **An evaluate must return a finite number.** A missing or non-numeric fitness is written into the population as it is, and silently corrupts selection, culling and the reported best.
- **Official fitness still comes from the task's evaluator, run the way the default evaluate runs it,** whatever evaluate provider is active.
- **Confine every worker to its candidate's own directory.** `spawnWorker` also accepts `options.confine`, which can override the directory; do not use it to widen what a worker can write.
- **Only candidates created by `allocate` or `copyTask` may be recorded.** Recording normally happens inside the loop; a provider that writes rows through `population()` must keep this rule itself.
- **The default select, survive and loop all treat higher fitness as better.**
- **The default mutate discards the worker's final reply.** If the search should learn from worker reports, the mutate you write must keep them, for example as files under `run/`.

## Learn from the effect

After changing the search machinery, continue the search and observe what happens.

Judge the change from evidence: whether it improves the search's ability to produce promising candidates, use its budget effectively, explore useful alternatives, or overcome the problem that motivated the change.

If the change does not help, revise it, remove it, restore an earlier mechanism, or try a different approach.

The machinery is there to serve one objective: **find the best candidate possible within the run's constraints.**
