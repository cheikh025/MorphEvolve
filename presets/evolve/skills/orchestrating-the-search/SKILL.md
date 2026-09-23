---
name: orchestrating-the-search
description: Use at the start of an EVOLVE run, and whenever you need the shape of the search — what `evolve_run` does on each pass, which of its arguments come from the user and which are yours, how to run it in chunks and read the population between them, and how to report the final answer. Load this before the first `evolve_run` call.
---

# Orchestrating the search

You are running EVOLVE: a search for the best solution to one task.
**You do not solve the task. You run the search that solves it.**

**Do not design, write, or prototype the solution yourself — not even to hand it to a worker.**

**A direction tells a worker where to look, never how to build.** Good directions come from the search: explore something unlike this parent; combine what worked in two candidates; fix the failures a parent's evaluation reports; refine a parent's approach; try a family of method no candidate has used yet. Bad directions come from you solving the problem: algorithm skeletons, moves, data structures, parameters, expected scores.

A quick test: could you have written this direction without knowing how to solve the problem? If not, cut it back.

In the first round there is no evidence yet. Leave the direction open, or ask for deliberately different kinds of approach without saying how.

This skill defines the initial search policy and the invariants that keep the search valid. Start here before the first `evolve_run` call.

The initial policy is simple:

select → mutate → evaluate → record → survive → repeat

The policy itself is not fixed. EVOLVE may change how candidates are selected, produced, compared, or managed as the search progresses.

Some rules are fixed, however: the task and evaluator must remain untouched, official fitness must come from the official evaluator, and a candidate must never change after its score has been recorded.

Think of this skill as the bootstrap for the search, not the final form of the search algorithm.

## Understand the task workspace

Each task is one directory holding the whole problem: the statement, the baseline solution, and the task's fixed evaluator with its settings. `evolve_run` creates its own `run/` directory inside it on the first call:

```text
<task>/
├── statement.md       the problem
├── solution.py        the baseline, with #EVOLVE_START / #EVOLVE_END markers
│                      (solution.cpp on C++ tasks)
├── task.json          how the evaluator runs: the solution file, timeout, retries, sandbox, environment
├── evaluator/         the fixed evaluator: evaluator.py defines evaluate(program_path);
│                      ALE-Bench tasks also hold private_eval.py (see Finish)
└── run/               created by evolve_run
    ├── candidates/
    │   ├── c000000/   the baseline: the statement and the solution file
    │   ├── c000001/   a full copy of its parent
    │   └── ...
    ├── evals/         the evaluator's full result for each candidate
    ├── population.jsonl
    └── budget.json
```

The files supplied with the task are fixed. Do not modify anything at the task root — `statement.md`, the solution file, `task.json`, `evaluator/`, or any other task-provided file. Changes happen only inside candidates.

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
| `max_population` | you | how many alive candidates the population may hold before it is culled (default 10) |
| `k` | you | how many candidates a cull keeps (default 5) |
| `candidates` | you | the most new candidates this call may create; omit it to run until the budget is used |

The first call writes `max_budget` into `run/budget.json`, and every later call must pass the same number — a different value is refused. Pass exactly the user's number every time, and never write or edit `run/budget.json` yourself.

### The first call

When `run/population.jsonl` has no rows, `evolve_run` first creates the baseline: it copies the task root into `run/candidates/c000000/` — everything except `run/`, `evaluator/`, `task.json` and `__pycache__`, so the statement and the solution file — evaluates it, and records it. The baseline does not consume candidate budget.

### Each pass

- **select** — picks a parent from the alive candidates. The default chooses in proportion to fitness.
- **mutate** — creates the next candidate as a full copy of that parent, spending one budget unit, then starts one worker confined to that candidate's own directory to improve it. The default worker is told the parent's score and writes one complete solution between the markers; it has no shell, so it cannot run the code or compare variants — scoring is the loop's evaluate step.
- **evaluate** — scores the candidate with the task's evaluator: `evaluate()` from `<task>/evaluator/evaluator.py`, called on a copy of the candidate's solution file without the marker lines. The evaluator chooses its own instances or test cases, and the fitness is its `combined_score`. A call that runs past `timeout` (from `task.json`) scores 0; a call that raises is retried up to `max_retries` times, then scores 0. The evaluator's full result — its metrics, and the error when a candidate failed — is saved in `run/evals/<id>.json`.
- **record** — appends one row to `run/population.jsonl`: `{"id", "parent", "fitness", "survival": "yes"}`.
- **survive** — once the number of alive candidates reaches `max_population`, keeps the top `k` and marks the rest `"survival": "no"`. Culled candidates keep their directories and their rows.

A worker that fails leaves its candidate unchanged; the candidate is still evaluated and recorded, and its budget unit stays spent. That is an ordinary outcome, and so is a candidate that does not compile, crashes, runs out of time or gives an invalid answer: it scores 0, and `run/evals/<id>.json` says why. An evaluator that cannot run at all is different: when it cannot even be loaded, it stops the call with the error, and it is something to investigate, not a bad candidate. Scores of 0 whose error is about Docker or the judge rather than the candidate are the same kind of problem.

The default steps treat higher fitness as better, except that a fitness of 0 is a failed evaluation and always ranks last. On minimize tasks the evaluator makes every score negative, so there too higher (closer to 0) is better; selection weighs those candidates by 1/|fitness|.

### Run in chunks

Pass `candidates` so that each call creates a few candidates and returns. Between calls, read `run/population.jsonl`: which parents are producing improvements, whether the best fitness is still moving, whether the alive candidates have collapsed into one line of descent (follow `parent`). Then call `evolve_run` again with the same `max_budget`; the run continues where it stopped, and the baseline is not redone.

The chunks are where you notice whether the search is still producing. Changes to the search machinery also happen between calls: the next call uses whatever is registered at that moment.

Interrupting the call stops the run. A candidate that was being worked on at that moment may be left allocated but not recorded; its budget unit stays spent. Only one run can execute at a time.

## Directing workers

The default mutate writes its own worker prompt. To give workers a direction, or to change their instructions, persona, model, or tools, register your own `mutate` provider — `improving-the-search-machinery` explains how. When you write that prompt, these rules hold.

The directory the worker is confined to is its entire world: it can write there and nowhere else. **Always confine it to the candidate's own directory, at least initially.** Confining it to the run root instead hands the worker every sibling candidate, the population file and the budget, which defeats the isolation the confinement exists to provide.

A worker starts with no history of this conversation and no memory of previous workers. Everything it needs comes from the prompt you write and from the files inside its candidate directory. The worker reads the problem from `statement.md` in its own directory, so do not restate it. Tell it what fitness means for this run, the rules it must keep, its direction, and any other useful instructions about how to work — never how to solve. Ask it to end with a short report in its final reply: what it tried, what it measured, and what it would try next. That report is how you learn what works without solving the problem yourself — but the default mutate discards it, so a mutate that wants reports must keep them, for example as a file under `run/`.

A candidate holds only the statement and the solution file. The evaluator stays at the task root, out of the worker's reach, so a worker cannot score its own work; scoring is the loop's evaluate step.

**Only the regions between `#EVOLVE_START` and `#EVOLVE_END` may change.** Everything else in a candidate — including its copy of the statement — is fixed scaffolding. Nothing enforces this, so say it in the worker's prompt, and check candidates when their scores look implausible.

## Official scores come from the task's evaluator

The default evaluate already follows these rules. They also bind any evaluation you run yourself, and any evaluator you register in its place.

A candidate's **official fitness** is the score the task's evaluator gives it, run the way the default evaluate runs it: `evaluate()` from `<task>/evaluator/evaluator.py`, on the candidate's solution file without the marker lines, with the timeout and retries in `task.json`. The evaluator decides which instances or test cases it uses. Other measurements — other cases, partial runs, proxies — may guide the search, but they must not be recorded as a candidate's official fitness.

`evaluator/private_eval.py`, on ALE-Bench tasks, is not an evaluator for the search: it scores hidden test cases once the search is over. Never run it, and never use its results.

If the evaluator itself fails rather than returning a valid evaluation result, treat it as an evaluation failure to investigate, not automatically as a bad candidate.

## Recorded candidates are finished

Recording happens inside the loop, after evaluation. A recorded candidate is finished: its directory must not change after that, even if a later cull drops it from the active population. To take that line further, a new child is allocated from it.

## Finish

`evolve_run` returns `best_id`, `best_fitness` and `remaining`. `best_fitness` is the highest fitness recorded in the run so far. The run ends when `remaining` reaches 0: no further candidate can be created.

Then report to the user: the best candidate's id, its official score (its recorded fitness), and where its directory is (`<task>/run/candidates/<id>`). On an ALE-Bench task, the benchmark's final result is the private evaluation of that candidate on hidden test cases, which is run after the session — not by you.

## Changing the search itself

As you run candidates, watch the behavior of the search. If several candidates show that the search is stagnating, repeatedly making unproductive attempts, collapsing into the same kinds of solutions, or you observe some other evidence that the current search mechanism is limiting progress, load `improving-the-search-machinery` skill and use it to reconsider the search.
