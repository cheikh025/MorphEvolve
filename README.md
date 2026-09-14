# Evolve kit

Everything needed to run EVOLVE on a new machine with the DeepSeek Harness (DSH): the two plugins, the Evolve preset, and the tasks. Written for Linux.

```text
evolve-kit/
├── setup.sh                 installs the plugins and the preset (one command)
├── dist/                    prebuilt plugin tarballs — setup.sh installs these
│   ├── dsh-dirspawn-0.1.0.tgz
│   └── dsh-evolve-loop-0.1.0.tgz
├── plugins/                 plugin source, for changes and rebuilding the tarballs
│   ├── dsh-dirspawn/        directory-confined workers (web tools blocked for workers)
│   └── dsh-evolve-loop/     the evolve service, evolve_run and evolve_status
├── presets/evolve/          the "Evolve Mode" preset: composition, persona, skills
└── tasks/                   ahc001, ahc002, ahc004, ahc005, ahc006, ahc009, ahc010
```

## Requirements

| what | version | check |
| --- | --- | --- |
| Node.js | 24.x (the harness needs `^22.19.0` or `>=24.0.0`) | `node -v` |
| pnpm | 11.7.0 | `pnpm -v` |
| DeepSeek Harness CLI | `@deepseek-ai/dsh` **0.1.2-rc.1** — the plugins were built against this version | `npm ls -g @deepseek-ai/dsh` |
| Python | 3, reachable as `python` (tested with 3.13) | `python --version` |
| bubblewrap | any (recommended; DSH's sandbox on Linux uses `bwrap`, then a Landlock launcher) | `bwrap --version` |

## Steps

### 1. Install the prerequisites

Debian/Ubuntu example (Node 24 already installed):

```bash
npm install -g pnpm@11.7.0
sudo apt install python-is-python3 bubblewrap
```

`python-is-python3` matters: the evaluator and the workers run `python`, not `python3`.

### 2. Install DSH

```bash
npm install -g @deepseek-ai/dsh@0.1.2-rc.1
```

Start it once with `dsh web` and set up your model and API key as usual, then stop it.

### 3. Get the kit

```bash
git clone <your-repo-url> evolve-kit
cd evolve-kit
```

### 4. Run the setup

```bash
bash setup.sh
```

It checks the requirements, installs both plugins from `dist/` into the `web` profile, copies the preset to `~/.dsh/.agent-presets/evolve`, and verifies the result. It is safe to run again: installed plugins are replaced, and an existing Evolve preset is moved to `~/.dsh/.agent-presets-backup/` first.

Other home or profile: `DSH_HOME=/path PROFILE=name bash setup.sh`.

### 5. Put the tasks where runs can write

A run writes `run/` inside its task folder. Keep runs out of the kit repository:

```bash
mkdir -p ~/evolve-tasks
cp -R tasks/* ~/evolve-tasks/
```

### 6. Start a run

1. Start DSH: `dsh web`, and open the page it prints.
2. Start a new session with the **Evolve Mode** preset and the task folder as its working directory, for example `~/evolve-tasks/ahc001`.
3. Give it the prompt:

```
Improve the solution for task ahc001 by orchestrating the search. Fitness is the mean score over seeds 0 to 49. The budget is 50 candidates. Run evolve_run in small chunks. Between chunks, analyze the runs, identify which mechanism of the search needs to be updated, improve that mechanism, and repeat.
```

## Checks

Run these after `setup.sh`. Each should give the expected result.

| check | command | expected |
| --- | --- | --- |
| plugins listed in the profile | `grep -A6 '"bundles"' ~/.dsh/profiles/web/package.json` | includes `dsh-dirspawn` and `dsh-evolve-loop` |
| workers cannot use the web | `grep -c web_search ~/.dsh/profiles/web/node_modules/dsh-dirspawn/lib/index.js` | `1` |
| status tool installed | `grep -c evolve_status ~/.dsh/profiles/web/node_modules/dsh-evolve-loop/src/index.js` | `2` |
| preset installed | `ls ~/.dsh/.agent-presets/evolve` | `agent.cordis.yml  preset.yml  skills` |
| evaluator works | `cd ~/evolve-tasks/ahc001 && python -B evaluate.py --candidate . --seed 0` | one JSON line with `"status": "VALID"` (the baseline scored 12461 on the development machine) |
| inside DSH | in an Evolve Mode session, ask it to call `evolve_status` | default providers for loop, select, mutate, evaluate, survive; `budget: null` before the first run |

## Troubleshooting

- **`python not found`** — install `python-is-python3`, or put a `python` symlink to `python3` on your PATH.
- **`SANDBOX_UNAVAILABLE`** — neither `bwrap` nor the Landlock launcher could start. Install `bubblewrap` and check that your system allows unprivileged user namespaces, which `bwrap` needs.
- **Evaluation fails at the baseline with a permission error** — the session's sandbox mode is `read-only`; the evaluator needs `workspace-write` to write its temporary files.
- **A different DSH version** — the plugins were built against 0.1.2-rc.1. With another version, rebuild them (below) and re-run the checks.

## Changing a plugin

After editing the source in `plugins/`, rebuild its tarball into `dist/` and run `bash setup.sh` again.

```bash
# dsh-evolve-loop (plain JavaScript, no build step)
cd plugins/dsh-evolve-loop && pnpm pack --pack-destination ../../dist

# dsh-dirspawn (TypeScript; packing runs the build)
cd plugins/dsh-dirspawn && pnpm install && pnpm pack --pack-destination ../../dist
```

Run a plugin's tests with `pnpm install && pnpm test` in its folder.

## Uninstall

```bash
dsh plugin --profile web remove dsh-evolve-loop
dsh plugin --profile web remove dsh-dirspawn
rm -rf ~/.dsh/.agent-presets/evolve
```
