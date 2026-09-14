# Evolve kit

Everything needed to run EVOLVE on a new machine with the DeepSeek Harness (DSH): the two plugins, the Evolve preset, and the tasks. Written for Linux, with DSH run from a source clone — including a Docker container reached over SSH, with persistent data under `/data`.

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

## Your paths

Every command below uses these four variables. Set them in each new shell (or add them to a shell startup file that survives container restarts):

```bash
export DSH_REPO=/data/cheikh/deepseek-harness   # your DSH clone (the folder with apps/cli/package.json)
export DSH_HOME=/data/cheikh/.dsh               # DSH's home: profiles, presets, settings, sessions
export KIT=/data/cheikh/evolve-kit              # this kit
export TASKS=/data/cheikh/evolve-tasks          # where runs write
```

**Why `DSH_HOME` is on `/data`:** by default DSH keeps everything in `~/.dsh`. In a container whose home folder is reset on restart, the installed plugins, the preset, your API settings and your sessions would disappear. `DSH_HOME` must have the **same value** when you run `setup.sh` and every time you start DSH — otherwise DSH reads another home and does not see the plugins or the preset.

## Requirements

| what | version | check |
| --- | --- | --- |
| Node.js | 24.x (the harness needs `^22.19.0` or `>=24.0.0`) | `node -v` |
| pnpm | 11.7.0 | `pnpm -v` |
| DeepSeek Harness | a clone of `deepseek-harness`, installed and built; the kit targets **0.1.5-rc.2**, the official repository's version when the kit was last updated | `node -p "require('$DSH_REPO/apps/cli/package.json').version"` |
| Python | 3, reachable as `python` (tested with 3.13) | `python --version` |
| bubblewrap | any; DSH's sandbox on Linux uses `bwrap`, then a Landlock launcher | `bwrap --version` |

**Do not also install `@deepseek-ai/dsh` globally with npm.** A second, older `dsh` on your PATH starts instead of your clone, shows fewer models, and can fail its API requests.

## Steps

### 1. Install the prerequisites

Debian/Ubuntu example (Node 24 already installed):

```bash
npm install -g pnpm@11.7.0
sudo apt install python-is-python3 bubblewrap
```

`python-is-python3` matters: the evaluator and the workers run `python`, not `python3`.

### 2. Check that the sandbox works inside the container

DSH runs the evaluator and the workers' shell commands inside a sandbox. `bwrap` needs to create namespaces, which Docker's default security settings often block:

```bash
bwrap --ro-bind / / true && echo "bwrap works"
```

If this fails with a namespace or permission error, DSH falls back to its Landlock launcher; if that also fails, sandboxed commands refuse to run (`SANDBOX_UNAVAILABLE`) and no candidate can be evaluated. The container then has to be started with a less restrictive seccomp/AppArmor profile — that is a setting of whoever runs the container.

### 3. Get DSH from source

Skip the clone if you already have it at `$DSH_REPO`:

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git "$DSH_REPO"
cd "$DSH_REPO"
pnpm install
pnpm run build
```

### 4. Get the kit

```bash
git clone https://github.com/cheikh025/evolve-kit.git "$KIT"
```

### 5. Run the setup

```bash
bash "$KIT/setup.sh"
```

It reads `DSH_REPO` and `DSH_HOME` from your shell. It checks the requirements and the clone, installs both plugins from `dist/` into the `web` profile through the clone's own CLI (`pnpm dsh plugin ...`), copies the preset to `$DSH_HOME/.agent-presets/evolve`, and verifies the result.

It is safe to run again: installed plugins are replaced, and an installed Evolve preset is moved to `$DSH_HOME/.agent-presets-backup/` first — see [The preset](#the-preset) before re-running it if the preset was changed on this machine.

It warns when your clone is not 0.1.5-rc.2 (run the checks below), and when another `dsh` is on your PATH.

### 6. Put the tasks where runs can write

A run writes `run/` inside its task folder:

```bash
mkdir -p "$TASKS"
cp -R "$KIT"/tasks/* "$TASKS"/
```

### 7. Start DSH and open it over SSH

```bash
cd "$DSH_REPO" && pnpm dsh web --no-open
```

DSH serves its page at `http://127.0.0.1:3080` inside the container, and over SSH it only prints the address. Forward that port from your own computer, then open `http://127.0.0.1:3080` there:

```bash
ssh -L 3080:127.0.0.1:3080 <user>@<container-host>
```

This works when your SSH session lands inside the container. If you reach the container another way (for example SSH to a host, then `docker exec`), the container's `127.0.0.1` is not the host's, and port 3080 must also be published by the container.

The first time, set up your model and API key in the page.

### 8. Start a run

1. Start a new session with the **Evolve Mode** preset and a task folder as its working directory, for example `/data/cheikh/evolve-tasks/ahc001`.
2. Give it the prompt:

```
Improve the solution for task ahc001 by orchestrating the search. Fitness is the mean score over seeds 0 to 49. The budget is 50 candidates. Run evolve_run in small chunks. Between chunks, analyze the runs, identify which mechanism of the search needs to be updated, improve that mechanism, and repeat.
```

## Checks

Run these after `setup.sh`. Each should give the expected result.

| check | command | expected |
| --- | --- | --- |
| paths set | `echo "$DSH_REPO $DSH_HOME"` | your two paths, in every shell you use |
| only the clone runs DSH | `which -a dsh` | nothing |
| DSH version | `node -p "require('$DSH_REPO/apps/cli/package.json').version"` | `0.1.5-rc.2`, or another version — then the last two checks matter most |
| sandbox | `bwrap --ro-bind / / true && echo ok` | `ok` |
| plugins listed in the profile | `grep -A6 '"bundles"' "$DSH_HOME/profiles/web/package.json"` | includes `dsh-dirspawn` and `dsh-evolve-loop` |
| workers cannot use the web | `grep -c web_search "$DSH_HOME/profiles/web/node_modules/dsh-dirspawn/lib/index.js"` | `1` |
| status tool installed | `grep -c evolve_status "$DSH_HOME/profiles/web/node_modules/dsh-evolve-loop/src/index.js"` | `2` |
| preset installed | `ls "$DSH_HOME/.agent-presets/evolve"` | `agent.cordis.yml  preset.yml  skills` |
| evaluator works | `cd "$TASKS/ahc001" && python -B evaluate.py --candidate . --seed 0` | one JSON line with `"status": "VALID"` (the baseline scored 12461 on the development machine) |
| the plugins load in DSH | in an Evolve Mode session, ask it to call `evolve_status` | default providers for loop, select, mutate, evaluate, survive; `budget: null` before the first run |
| workers run in DSH | in a task folder, ask it to run `evolve_run` with `candidates: 1` | a worker starts, and the new candidate gets a score |

## The preset

There are two copies of the Evolve preset, and they are not linked:

| copy | where | used for |
| --- | --- | --- |
| installed | `$DSH_HOME/.agent-presets/evolve` | what DSH actually runs |
| kit | `$KIT/presets/evolve` | what `setup.sh` installs and what is in git |

The preset holds the composition (`agent.cordis.yml`, which includes the persona), the name shown in DSH (`preset.yml`), and the skills (`skills/`).

### Export changes made on this machine

If you edit the installed preset, or the agent changes it during a run, those changes exist only in `$DSH_HOME`. Copy them back into the kit **before** running `setup.sh` again (setup replaces the installed preset with the kit's copy), then push:

```bash
rm -rf "$KIT/presets/evolve"
cp -R "$DSH_HOME/.agent-presets/evolve" "$KIT/presets/evolve"
cd "$KIT" && git add presets && git commit -m "Update the Evolve preset" && git push
```

Presets the agent creates are other folders in `$DSH_HOME/.agent-presets/`; copy any you want to keep into `$KIT/presets/` the same way. If you already ran `setup.sh` over a changed preset, the changed copy is in `$DSH_HOME/.agent-presets-backup/`.

### Import changes from the kit

After someone pushed a preset change:

```bash
cd "$KIT" && git pull
bash "$KIT/setup.sh"
```

Then restart DSH.

### After updating the DSH clone

The Evolve composition started as a copy of DSH's own `cordis` preset, with its own persona and skills. If an Evolve Mode session fails to start after you update `$DSH_REPO`, compare the two compositions:

```bash
diff "$KIT/presets/evolve/agent.cordis.yml" "$DSH_REPO/packages/preset/agent-presets/presets/cordis/agent.cordis.yml"
```

Bring over the rows that changed in the new `cordis` preset, keep the Evolve `persona` row and the `skills/` folder, then export and run `setup.sh` as above.

## Updating everything

```bash
cd "$KIT" && git pull
bash "$KIT/setup.sh"
```

Restart DSH (`cd "$DSH_REPO" && pnpm dsh web --no-open`).

## Troubleshooting

- **The Evolve preset or the plugins are missing in DSH** — DSH was started with a different `DSH_HOME` than `setup.sh` used. Check `echo $DSH_HOME` in the shell that starts DSH.
- **Fewer models than before, or DeepSeek API requests fail** — an older `dsh` is running instead of your clone. Check `which -a dsh`; remove a global install with `npm uninstall -g @deepseek-ai/dsh`, and start DSH with `pnpm dsh web` from the clone.
- **`SANDBOX_UNAVAILABLE`** — neither `bwrap` nor the Landlock launcher could start; see step 2.
- **`python not found`** — install `python-is-python3`, or put a `python` symlink to `python3` on your PATH.
- **The page does not open** — forward port 3080 (step 7); DSH does not open a browser over SSH.
- **Evaluation fails at the baseline with a permission error** — the session's sandbox mode is `read-only`; the evaluator needs `workspace-write` to write its temporary files.
- **Everything disappeared after a container restart** — `DSH_HOME`, the clone, the kit or the tasks were outside `/data`.
- **Evolve Mode is listed but cannot be selected** — its composition does not match your DSH version. For example, in 0.1.5 the persona plugin's settings changed from `text` to `prefix` and `suffix`. Compare it with your clone's `cordis` preset (see [After updating the DSH clone](#after-updating-the-dsh-clone)).
- **`evolve_status` or a worker fails** — the plugins are built and tested against DSH 0.1.5-rc.2. On another version something they use may have changed; keep the exact error, since the plugin source may then need updating for that version.

## Changing a plugin

After editing the source in `plugins/`, rebuild its tarball into `dist/` and run `setup.sh` again.

```bash
# dsh-evolve-loop (plain JavaScript, no build step)
cd "$KIT/plugins/dsh-evolve-loop" && pnpm pack --pack-destination ../../dist

# dsh-dirspawn (TypeScript; packing runs the build)
cd "$KIT/plugins/dsh-dirspawn" && pnpm install && pnpm pack --pack-destination ../../dist
```

Run a plugin's tests with `pnpm install && pnpm test` in its folder.

## Uninstall

```bash
cd "$DSH_REPO"
pnpm dsh plugin --profile web remove dsh-evolve-loop
pnpm dsh plugin --profile web remove dsh-dirspawn
rm -rf "$DSH_HOME/.agent-presets/evolve"
```
