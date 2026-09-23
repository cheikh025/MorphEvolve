# Evolve kit

Everything needed to run EVOLVE on a new machine with the DeepSeek Harness (DSH): the two plugins, the Evolve preset, and the benchmark tasks with their evaluators. Written for Linux, with DSH run from a source clone — including a Docker container reached over SSH.

```text
evolve-kit/
├── setup.sh                 installs DSH, the plugins, the preset and the benchmark evaluators (one command)
├── PROMPT.md                the prompt to give an Evolve Mode session
├── final_eval.py            final score of a finished ALE-Bench run (private evaluation)
├── private_eval.py          the ALE-Bench private evaluation that final_eval.py runs
├── dist/                    prebuilt plugin tarballs — setup.sh installs these
│   ├── dsh-candidate-builder-0.1.0.tgz
│   └── dsh-evolve-loop-0.1.0.tgz
├── plugins/                 plugin source, for changes and rebuilding the tarballs
│   ├── dsh-candidate-builder/        directory-confined workers (web tools blocked for workers)
│   └── dsh-evolve-loop/     the evolve service, evolve_run and evolve_status
├── presets/evolve/          the "Evolve Mode" preset: composition, persona, skills
└── tasks/
    ├── ale_bench/           10 ALE-Bench problems (ahc008, ahc011, ...)
    ├── frontier_cs/         172 Frontier-CS problems (0, 1, 10, ...)
    ├── math/                8 math problems (circle_packing, heilbronn_triangle, ...)
    └── evaluator_sources.json   where each evaluator was taken from
```

## Requirements

| what | version | check |
| --- | --- | --- |
| Node.js | 24.x (the harness needs `^22.19.0` or `>=24.0.0`) | `node -v` |
| pnpm | 11.7.0 | `pnpm -v` |
| git | any | `git --version` |
| DeepSeek Harness | a source clone pinned to **0.1.5-rc.2** (tag `dsh-v0.1.5-rc.2`). `setup.sh` clones and builds it when `$DSH_REPO` is missing, so you do not have to — never install `@deepseek-ai/dsh` from npm instead | `node -p "require('$DSH_REPO/apps/cli/package.json').version"` |
| Python | 3.11 to 3.14, reachable as `python` (tested with 3.13), with `venv` | `python --version` |
| Docker | Engine 24+ with the Compose plugin, usable by your user; the ALE-Bench and Frontier-CS judges run in Docker | `docker version` and `docker compose version` |
| bubblewrap | any; DSH's sandbox on Linux uses `bwrap`, then a Landlock launcher | `bwrap --version` |

**Do not also install `@deepseek-ai/dsh` globally with npm.** A second, older `dsh` on your PATH starts instead of your clone, shows fewer models, and can fail its API requests.

## Steps

### Step 1. Set your paths

Every command below uses these four path variables, all under one base folder you choose. Set them in each new shell (or add them to a shell startup file that survives restarts):

```bash
export BASE=/path/you/choose                 # any folder that survives restarts
export DSH_REPO=$BASE/deepseek-harness       # your DSH clone (the folder with apps/cli/package.json)
export DSH_HOME=$BASE/.dsh                   # DSH's home: profiles, presets, settings, sessions
export KIT=$BASE/evolve-kit                  # this kit
export TASKS=$BASE/evolve-tasks              # where runs write
```

**In a container:** by default DSH keeps everything in `~/.dsh`. If the container's home folder is reset on restart, the installed plugins, the preset, your API settings and your sessions would disappear — put `BASE` on a persistent volume (for example a mounted `/data`).

`DSH_HOME` must have the **same value** when you run `setup.sh` and every time you start DSH — otherwise DSH reads another home and does not see the plugins or the preset.

### Step 2. Install the prerequisites

Debian/Ubuntu example (Node 24 already installed):

```bash
npm install -g pnpm@11.7.0
sudo apt install python-is-python3 python3-venv bubblewrap libcairo2-dev libffi-dev
```

`python-is-python3` matters: the evaluator and the workers run `python`, not `python3`. The cairo libraries are needed by ALE-Bench.

Install Docker Engine 24+ with the Compose plugin (see https://docs.docker.com/engine/install/), then let your user run it and log in again:

```bash
sudo usermod -aG docker $USER
```

### Step 3. Check that the sandbox works

DSH runs the evaluator and the workers' shell commands inside a sandbox. `bwrap` needs to create namespaces, which Docker's default security settings often block:

```bash
bwrap --ro-bind / / true && echo "bwrap works"
```

If this fails with a namespace or permission error, DSH falls back to its Landlock launcher; if that also fails, sandboxed commands refuse to run (`SANDBOX_UNAVAILABLE`) and no candidate can be evaluated. The container then has to be started with a less restrictive seccomp/AppArmor profile — that is a setting of whoever runs the container.

### Step 4. Get the kit

```bash
git clone https://github.com/cheikh025/evolve-kit.git "$KIT"
```

### Step 5. Run the setup

```bash
bash "$KIT/setup.sh"
```

That one command does the rest: it checks the requirements, clones and builds DSH 0.1.5-rc.2 at `$DSH_REPO` (or uses the clone already there), installs both plugins and the Evolve preset into `$DSH_HOME`, and verifies the result. It is safe to run again.

It also installs what the task evaluators need, under `$DSH_HOME/benchmarks`: pinned clones of Frontier-CS and ALE-Bench, a Python environment with the evaluator packages (`$DSH_HOME/benchmarks/venv`), the ALE-Bench Docker images, and the Frontier-CS judge, which it starts at `http://localhost:8081`. The first run takes a while.

If you already have a DSH clone, point `DSH_REPO` at it first. If it is not on 0.1.5-rc.2, commit or stash your work in it so setup can switch it.

### Step 6. Copy the tasks where runs can write

A run writes `run/` inside its task folder:

```bash
mkdir -p "$TASKS"
cp -R "$KIT"/tasks/* "$TASKS"/
```

Each task is a folder such as `$TASKS/math/circle_packing`, `$TASKS/ale_bench/ahc008` or `$TASKS/frontier_cs/0`, with the problem in `statement.md`, the starting program (`solution.py` or `solution.cpp`), the evaluator in `evaluator/`, and its settings in `task.json`.

### Step 7. Start DSH and open it

The task evaluators run with `python`, so start DSH with the benchmark environment first on your PATH:

```bash
cd "$DSH_REPO" && PATH="$DSH_HOME/benchmarks/venv/bin:$PATH" pnpm dsh web --no-open
```

DSH serves its page at `http://127.0.0.1:3080` inside the container, and over SSH it only prints the address. Forward that port from your own computer, then open `http://127.0.0.1:3080` there:

```bash
ssh -L 3080:127.0.0.1:3080 <user>@<container-host>
```

This works when your SSH session lands inside the container. If you reach the container another way (for example SSH to a host, then `docker exec`), the container's `127.0.0.1` is not the host's, and port 3080 must also be published by the container.

The first time, add your DeepSeek API key in the page.

### Step 8. Start a run

In the DSH page, for each run:

1. Start a new session.
2. Select the **Evolve Mode** preset.
3. Set the working directory to a task folder, for example `$TASKS/math/circle_packing`.
4. Choose the model **DeepSeek Flash 4.1**.
5. Set reasoning to **max**.
6. Give it **full access**.
7. Give it the prompt in [`PROMPT.md`](PROMPT.md), which `setup.sh` also prints when it finishes:

```
Improve the solution for the task in this folder by orchestrating and improving the search process. Fitness is the mean score over seeds 0 to 49, and the total budget is 100 candidates. Run evolve_run in small chunks rather than using the full budget at once. Between chunks, analyze the results and determine which part or mechanism of the search is limiting progress, stalling, underperforming, or could be made more effective. Update and improve that specific search mechanism, then run another small chunk and repeat this process. Make improvements whenever the search stalls or when the run data suggests that some part of the search strategy could be better. Do not focus on directly solving the task yourself; your role is to orchestrate, diagnose, and improve the search strategy so that the search can discover better solutions. Do not use the web, do not search for existing solutions, and do not give any subagent the option to use the web or search externally for solutions.
```

### Step 9. (ALE-Bench tasks only) Get the final score

For ALE-Bench tasks, the score during the search is on the public test cases. When the run is finished, score its best candidate on the hidden test cases:

```bash
"$DSH_HOME/benchmarks/venv/bin/python" "$KIT/final_eval.py" "$TASKS/ale_bench/ahc008"
```

It prints the result and saves it to `run/final.txt` in the task folder. For the other tasks, the fitness recorded during the run is the final score.

### Step 10. (optional) Check the install

Run these after `setup.sh`. Each should give the expected result.

| check | command | expected |
| --- | --- | --- |
| paths set | `echo "$DSH_REPO $DSH_HOME"` | your two paths, in every shell you use |
| only the clone runs DSH | `which -a dsh` | nothing |
| DSH version | `node -p "require('$DSH_REPO/apps/cli/package.json').version"` | `0.1.5-rc.2`, or another version — then the last two checks matter most |
| sandbox | `bwrap --ro-bind / / true && echo ok` | `ok` |
| plugins listed in the profile | `grep -A6 '"bundles"' "$DSH_HOME/profiles/web/package.json"` | includes `dsh-candidate-builder` and `dsh-evolve-loop` |
| workers cannot use the web | `grep -c web_search "$DSH_HOME/profiles/web/node_modules/dsh-candidate-builder/lib/index.js"` | `1` |
| status tool installed | `grep -c evolve_status "$DSH_HOME/profiles/web/node_modules/dsh-evolve-loop/src/index.js"` | `2` |
| preset installed | `ls "$DSH_HOME/.agent-presets/evolve"` | `agent.cordis.yml  preset.yml  skills` |
| evaluator environment | `"$DSH_HOME/benchmarks/venv/bin/python" --version` | Python 3.11 to 3.14 |
| Frontier-CS judge | `curl -s -o /dev/null -w '%{http_code}
' http://localhost:8081/problems` | `200` |
| ALE-Bench image | `docker image inspect ale-bench:cpp20-202301 --format ok` | `ok` |
| evaluator works | `cd "$TASKS/math/circle_packing" && "$DSH_HOME/benchmarks/venv/bin/python" -B "$DSH_HOME/profiles/web/node_modules/dsh-evolve-loop/src/providers/run_evaluator.py" . solution.py` | one JSON line with `"fitness"` and `"metrics"` |
| the plugins load in DSH | in an Evolve Mode session, ask it to call `evolve_status` | default providers for loop, select, mutate, evaluate, survive; `budget: null` before the first run |
| workers run in DSH | in a task folder, ask it to run `evolve_run` with `candidates: 1` | a worker starts, and the new candidate gets a score |

## Troubleshooting

- **The Evolve preset or the plugins are missing in DSH** — DSH was started with a different `DSH_HOME` than `setup.sh` used. Check `echo $DSH_HOME` in the shell that starts DSH.
- **Fewer models than before, or DeepSeek API requests fail** — an older `dsh` is running instead of your clone. Check `which -a dsh`; remove a global install with `npm uninstall -g @deepseek-ai/dsh`, and start DSH with `pnpm dsh web` from the clone.
- **`SANDBOX_UNAVAILABLE`** — neither `bwrap` nor the Landlock launcher could start; see Step 3.
- **`python not found`** — install `python-is-python3`, or put a `python` symlink to `python3` on your PATH.
- **Every candidate fails to evaluate with an import error** — DSH was started without the benchmark environment on its PATH; start it as in Step 7.
- **setup.sh cannot reach Docker** — start the Docker daemon and add your user to the `docker` group (Step 2), then log in again.
- **The Frontier-CS judge does not answer** — see its logs with `cd "$DSH_HOME/benchmarks/Frontier-CS/algorithmic" && docker compose logs`. It runs as a privileged container, which Docker must allow.
- **The page does not open** — forward port 3080 (Step 7); DSH does not open a browser over SSH.
- **Evaluation fails at the baseline with a permission error** — the session's sandbox mode is `read-only`; the evaluator needs `workspace-write` to write its temporary files.
- **Everything disappeared after a container restart** — `DSH_HOME`, the clone, the kit or the tasks were not under a persistent folder.
- **Evolve Mode is listed but cannot be selected** — its composition does not match your DSH version. For example, in 0.1.5 the persona plugin's settings changed from `text` to `prefix` and `suffix`. Compare `$KIT/presets/evolve/agent.cordis.yml` with your clone's `packages/preset/agent-presets/presets/cordis/agent.cordis.yml`.
- **`evolve_status` or a worker fails** — the plugins are built and tested against DSH 0.1.5-rc.2. On another version something they use may have changed; keep the exact error, since the plugin source may then need updating for that version.

## Uninstall

```bash
cd "$DSH_REPO"
pnpm dsh plugin --profile web remove dsh-evolve-loop
pnpm dsh plugin --profile web remove dsh-candidate-builder
rm -rf "$DSH_HOME/.agent-presets/evolve"
cd "$DSH_HOME/benchmarks/Frontier-CS/algorithmic" && docker compose down
rm -rf "$DSH_HOME/benchmarks"
```
