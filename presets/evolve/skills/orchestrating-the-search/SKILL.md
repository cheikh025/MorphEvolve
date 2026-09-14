---
name: orchestrating-the-search
description: Use at the start of an EVOLVE run, and whenever you need the shape of the search — what `evolve_run` does on each pass, which of its arguments come from the user and which are yours, how to run it in chunks and read the population between them, and how to report the final answer. Load this before the first `evolve_run` call.
---

# Orchestrating the search

You are running EVOLVE: a search for the best solution to one task.
**You do not solve the task. You run the search that solves it.**

**Do not design, write, or prototype the solution yourself — not even to hand it to a worker.**

**A direction tells a worker where to look, never how to build.** Good directions come from the search: explore something unlike this parent; combine what worked in two candidates; fix the seeds a parent fails on; refine a parent's approach; try a family of method no candidate has used yet. Bad directions come from you solving the problem: algorithm skeletons, moves, data structures, parameters, expected scores.

A quick test: could you have written this direction without knowing how to solve the problem? If not, cut it back.

In the first round there is no evidence yet. Leave the direction open, or ask for deliberately different kinds of approach without saying how.

This skill defines the initial search policy and the invariants that keep the search valid. Start here before the first `evolve_run` call.

The initial policy is simple:

select → mutate → evaluate → record → survive → repeat

The policy itself is not fixed. EVOLVE may change how candidates are selected, produced, compared, or managed as the search progresses.

Some rules are fixed, however: the task and evaluator must remain untouched, official fitness must come from the official evaluator, and a candidate must never change after its score has been recorded.

Think of this skill as the bootstrap for the search, not the final form of the search algorithm.

## Understand the task workspace

Each task is one flat directory holding the whole problem: the statement, the baseline solution, and the fixed files that generate and score instances. `evolve_run` creates its own `run/` directory inside it on the first call:

```text
<task>/
├── statement.md       the problem
├── solution.py        the baseline, with #EVOLVE_START / #EVOLVE_END markers
├── generate.py        seed → instance
├── judge.py           score one output
├── evaluate.py        evaluate one candidate on one seed
├── example_*.txt, images/, ...
└── run/               created by evolve_run
    ├── candidates/
    │   ├── c000000/   a full copy of the task
    │   ├── c000001/   a full copy of its parent
    │   └── ...
    ├── population.jsonl
    └── budget.json
```

The files supplied with the task are fixed. Do not modify anything at the task root — `statement.md`, `solution.py`, `generate.py`, `judge.py`, `evaluate.py`, or any other task-provided file. Changes happen only inside candidates.

`<task>/run/` is EVOLVE's writable workspace. Everything produced by the search belongs there: candidate directories, population state, budget state, and any other state EVOLVE creates while searching.

The important boundary is:

```text
task-provided files = fixed
run/                = created and writable by EVOLVE
```

EVOLVE may change its candidates and its own search machinery inside `run/`, but it must never alter the problem it is being evaluated against.

## Run the search with `evolve_run`

`evolve_run` runs the search loop and blocks until it returns. You do not create `run/`, the budget file, or the baseline yourself — the tool does.

| argument | comes from | meaning |
| --- | --- | --- |
| `max_budget` | the user | total number of new candidates for the whole run; the baseline does not count |
| `seeds` | the user | the official seeds every candidate is scored on — the full official set, never a subset |
| `max_population` | you | how many alive candidates the population may hold before it is culled (default 10) |
| `k` | you | how many candidates a cull keeps (default 5) |
| `candidates` | you | the most new candidates this call may create; omit it to run until the budget is used |

The first call writes `max_budget` into `run/budget.json`, and every later call must pass the same number — a different value is refused. Pass exactly the user's number every time, and never write or edit `run/budget.json` yourself.

### The first call

When `run/population.jsonl` has no rows, `evolve_run` first creates the baseline: it copies everything at the task root into `run/candidates/c000000/` (everything except `run/` itself and `__pycache__`), evaluates it on all seeds, and records it. The baseline does not consume candidate budget.

### Each pass

- **select** — picks a parent from the alive candidates. The default chooses in proportion to fitness.
- **mutate** — creates the next candidate as a full copy of that parent, spending one budget unit, then starts one worker confined to that candidate's own directory to improve it. The default worker is told the parent's score, to change only the marked region, and to remove its scratch files.
- **evaluate** — scores the candidate with the task-root evaluator, once per seed, and takes the mean. Each seed has 60 seconds.
- **record** — appends one row to `run/population.jsonl`: `{"id", "parent", "fitness", "survival": "yes"}`.
- **survive** — once the number of alive candidates reaches `max_population`, keeps the top `k` and marks the rest `"survival": "no"`. Culled candidates keep their directories and their rows.

A worker that fails leaves its candidate unchanged; the candidate is still evaluated and recorded, and its budget unit stays spent. That is an ordinary outcome. An evaluator failure is different: it stops the call with the error, and it is something to investigate, not a bad candidate.

The default steps treat higher fitness as better.

### Run in chunks

Pass `candidates` so that each call creates a few candidates and returns. Between calls, read `run/population.jsonl`: which parents are producing improvements, whether the best fitness is still moving, whether the alive candidates have collapsed into one line of descent (follow `parent`). Then call `evolve_run` again with the same `max_budget` and `seeds`; the run continues where it stopped, and the baseline is not redone.

The chunks are where you notice whether the search is still producing. Changes to the search machinery also happen between calls: the next call uses whatever is registered at that moment.

Interrupting the call stops the run. A candidate that was being worked on at that moment may be left allocated but not recorded; its budget unit stays spent. Only one run can execute at a time.

## Directing workers

The default mutate writes its own worker prompt. To give workers a direction, or to change their instructions, persona, model, or tools, register your own `mutate` provider — `improving-the-search-machinery` explains how. When you write that prompt, these rules hold.

The directory the worker is confined to is its entire world: it can write there and nowhere else. **Always confine it to the candidate's own directory, at least initially.** Confining it to the run root instead hands the worker every sibling candidate, the population file and the budget, which defeats the isolation the confinement exists to provide.

A worker starts with no history of this conversation and no memory of previous workers. Everything it needs comes from the prompt you write and from the files inside its candidate directory. The worker reads the problem from `statement.md` in its own directory, so do not restate it. Tell it what fitness means for this run, the rules it must keep, its direction, and any other useful instructions about how to work — never how to solve. Ask it to end with a short report in its final reply: what it tried, what it measured, and what it would try next. That report is how you learn what works without solving the problem yourself — but the default mutate discards it, so a mutate that wants reports must keep them, for example as a file under `run/`.

Every candidate carries its own copy of the evaluator, so a worker can test its work without leaving its directory. With shell access, which the default mutate grants, it runs `python -B evaluate.py --candidate . --seed <n>` inside the candidate. `-B` stops Python writing `__pycache__` into the candidate, where it would be frozen once the candidate is recorded and inherited by every child.

**Only the regions between `#EVOLVE_START` and `#EVOLVE_END` may change.** Everything else in a candidate — including its copies of the statement, generator, judge and evaluator — is fixed scaffolding. Nothing enforces this, so say it in the worker's prompt, and check candidates when their scores look implausible.

## Evaluate on the full official set

The default evaluate already follows these rules. They also bind any evaluation you run yourself, and any evaluator you register in its place.

An **official fitness** must be based on the complete official evaluation set. Partial evaluations or additional development instances may be useful during the search, but they must not be recorded as the candidate's official fitness.

Official scores always come from the task's own evaluator at the task root, run against the candidate:

```
python -B <task>/evaluate.py --candidate <task>/run/candidates/<id> --seed <n>
```

Never use the evaluator inside a candidate for an official score. A candidate is writable by its worker, so its copies of `evaluate.py`, `judge.py` and `generate.py` may have been changed. The task-root evaluator takes only `solution.py` from the candidate and scores it with its own, untouched generator and judge.

If the evaluator itself fails rather than returning a valid evaluation result, treat it as an evaluation failure to investigate, not automatically as a bad candidate.

## Recorded candidates are finished

Recording happens inside the loop, after evaluation. A recorded candidate is finished: its directory must not change after that, even if a later cull drops it from the active population. To take that line further, a new child is allocated from it.

## Finish

`evolve_run` returns `best_id`, `best_fitness` and `remaining`. `best_fitness` is the highest fitness recorded in the run so far. The run ends when `remaining` reaches 0: no further candidate can be created.

Then report to the user: the best candidate's id, its official score, and where its directory is (`<task>/run/candidates/<id>`). Confirm the number by re-scoring that directory with the task-root evaluator on every official seed before you report it.

## Changing the search itself

As you run candidates, watch the behavior of the search. If several candidates show that the search is stagnating, repeatedly making unproductive attempts, collapsing into the same kinds of solutions, or you observe some other evidence that the current search mechanism is limiting progress, load `improving-the-search-machinery` skill and use it to reconsider the search.
