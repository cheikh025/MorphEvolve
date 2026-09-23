#!/usr/bin/env bash
# Install the Evolve kit into a DeepSeek Harness home, using a DSH source clone:
#   - checks the prerequisites (node, pnpm, git, python 3.11-3.14, bwrap, docker)
#   - clones, pins and builds the DSH clone when it is missing or on another version
#   - installs the dsh-candidate-builder and dsh-evolve-loop plugins, from dist/, into a profile;
#     dsh-evolve-loop also declares the Evolve Mode agent preset
#   - installs what the benchmark evaluators (tasks/*/*/evaluator) need, under $BENCH_HOME:
#     pinned clones of Frontier-CS and ALE-Bench, a Python environment with the evaluator
#     packages, the ALE-Bench execution images and the Frontier-CS judge server (Docker)
#
# Usage: bash setup.sh
# Environment: DSH_REPO (default ~/deepseek-harness), DSH_HOME (default ~/.dsh),
#              PROFILE (default web), DSH_REMOTE, DSH_REF,
#              BENCH_HOME (default $DSH_HOME/benchmarks), FRONTIER_CS_REMOTE, FRONTIER_CS_REF,
#              ALE_BENCH_REMOTE, ALE_BENCH_REF
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_REPO="${DSH_REPO:-$HOME/deepseek-harness}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGINS=(dsh-candidate-builder dsh-evolve-loop)
# The harness version the plugins and the preset were built and tested against,
# and the tag that carries it. The preset is declared through a bundle patch and
# the runtime tools use the dynamic plugin runner as 0.1.7 ships them, and the
# plugins' DSH peer ranges (>=0.1.7-rc.1 <0.2.0) make DSH refuse them elsewhere.
BUILT_AGAINST="0.1.7-rc.1"
DSH_REMOTE="${DSH_REMOTE:-https://github.com/deepseek-ai/deepseek-harness.git}"
DSH_REF="${DSH_REF:-dsh-v0.1.7-rc.1}"
# What the benchmark evaluators run against. Frontier-CS is pinned to the commit the
# task statements were taken from, so its judge holds the matching test data; ALE-Bench
# is pinned so every machine judges the same way. Both methods under comparison must
# use these same judges.
BENCH_HOME="${BENCH_HOME:-$DSH_HOME/benchmarks}"
BENCH_VENV="$BENCH_HOME/venv"
BENCH_PY="$BENCH_VENV/bin/python"
FRONTIER_CS_DIR="$BENCH_HOME/Frontier-CS"
FRONTIER_CS_REMOTE="${FRONTIER_CS_REMOTE:-https://github.com/FrontierCS/Frontier-CS.git}"
FRONTIER_CS_REF="${FRONTIER_CS_REF:-1bccbadc6bead714d25c546cf954a37bb0791fd6}"
FRONTIER_CS_JUDGE="http://localhost:8081"
ALE_BENCH_DIR="$BENCH_HOME/ALE-Bench"
ALE_BENCH_REMOTE="${ALE_BENCH_REMOTE:-https://github.com/SakanaAI/ALE-Bench.git}"
ALE_BENCH_REF="${ALE_BENCH_REF:-3da9b12fb5d112dabb3af693d1a42031c95142bc}"

fail() { echo "setup: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found on PATH. $2"; }
# Run the clone's own CLI, exactly as `pnpm dsh ...` from the clone.
dsh_clone() { (cd "$DSH_REPO" && pnpm dsh "$@"); }
clone_version() { node -p 'require(process.argv[1]).version' "$DSH_REPO/apps/cli/package.json"; }
# Clone $2 into $1 when missing, and check out commit $3. A clone on another commit is
# switched, unless it has uncommitted changes to tracked files.
pinned_clone() {
  local dir="$1" remote="$2" ref="$3" want
  if [ ! -d "$dir/.git" ]; then
    if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
      fail "$dir exists but is not a git clone. Move it aside and run setup.sh again."
    fi
    echo "-- cloning $remote"
    git clone --quiet --filter=blob:none "$remote" "$dir"
  fi
  if ! git -C "$dir" rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
    git -C "$dir" fetch --quiet origin || fail "$ref is not in $dir and fetching from origin failed."
  fi
  want="$(git -C "$dir" rev-parse --verify --quiet "$ref^{commit}")" \
    || fail "$ref is not a commit of $remote"
  if [ "$(git -C "$dir" rev-parse HEAD)" != "$want" ]; then
    [ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ] \
      || fail "$dir is not at $ref and has uncommitted changes. Commit or stash them, then run setup.sh again."
    git -C "$dir" -c advice.detachedHead=false checkout --quiet "$want"
  fi
  echo "-- $(basename "$dir") at ${want:0:12}"
}

echo "== 1/6 checks"
need node "Install Node.js 24 (the harness needs ^22.19.0 or >=24.0.0)."
need pnpm "Install pnpm 11.7.0, e.g.: npm install -g pnpm@11.7.0"
need git "Install git, e.g.: sudo apt install git"
need python "The evaluator is started as 'python'. On Debian/Ubuntu: sudo apt install python-is-python3"
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    console.error(`setup: Node ${process.version} is not supported; the harness needs ^22.19.0 or >=24.0.0`)
    process.exit(1)
  }
'
python -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' \
  || fail "'python' is not Python 3. On Debian/Ubuntu: sudo apt install python-is-python3"
python -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] < (3, 15) else 1)' \
  || fail "$(python --version 2>&1) is not supported: the benchmark evaluators need Python 3.11 to 3.14 (Frontier-CS needs 3.11+, ALE-Bench below 3.15)."
need docker "Install Docker Engine 24+ (https://docs.docker.com/engine/install/): the ALE-Bench and Frontier-CS judges run in Docker."
docker info >/dev/null 2>&1 \
  || fail "cannot reach the Docker daemon. Start it and let your user run docker, e.g.: sudo usermod -aG docker \$USER (then log in again)."
docker_version="$(docker version --format '{{.Server.Version}}')"
[ "${docker_version%%.*}" -ge 24 ] 2>/dev/null \
  || fail "Docker $docker_version is too old: the Frontier-CS judge needs Docker 24+."
docker compose version >/dev/null 2>&1 \
  || fail "the Docker Compose plugin is missing: the Frontier-CS judge starts with 'docker compose'. On Debian/Ubuntu: sudo apt install docker-compose-plugin"
echo "node $(node -v) | pnpm $(pnpm -v) | $(python --version 2>&1) | git $(git --version | awk '{print $3}') | docker $docker_version"
if command -v dsh >/dev/null 2>&1; then
  echo "setup: warning: another 'dsh' is on your PATH ($(command -v dsh)). Start DSH from the clone (pnpm dsh web), or that one may run instead." >&2
fi
if command -v bwrap >/dev/null 2>&1; then
  echo "sandbox: bwrap found"
else
  echo "setup: warning: bwrap not found. DSH will try its Landlock launcher; if that also fails, sandboxed commands refuse to run. Recommended: sudo apt install bubblewrap" >&2
fi
for pkg in "${PLUGINS[@]}"; do
  [ -f "$KIT/dist/$pkg-0.1.0.tgz" ] || fail "missing $KIT/dist/$pkg-0.1.0.tgz"
done
[ -f "$KIT/PROMPT.md" ] || fail "missing $KIT/PROMPT.md"

echo "== 2/6 DSH clone -> $DSH_REPO (kit targets $BUILT_AGAINST)"
needs_build=0
if [ ! -f "$DSH_REPO/apps/cli/package.json" ]; then
  if [ -e "$DSH_REPO" ] && [ -n "$(ls -A "$DSH_REPO" 2>/dev/null)" ]; then
    fail "$DSH_REPO exists but is not a DeepSeek Harness clone. Move it aside, or set DSH_REPO to your clone."
  fi
  echo "-- cloning $DSH_REMOTE at $DSH_REF"
  git clone --quiet "$DSH_REMOTE" "$DSH_REPO"
  git -C "$DSH_REPO" -c advice.detachedHead=false checkout --quiet "$DSH_REF"
  needs_build=1
else
  echo "-- found a clone reporting $(clone_version)"
fi

version="$(clone_version)"
if [ "$version" != "$BUILT_AGAINST" ]; then
  # The version, not the commit, is what the plugins and the preset depend on:
  # a clone already reporting $BUILT_AGAINST is left exactly where it is.
  [ -d "$DSH_REPO/.git" ] \
    || fail "the clone at $DSH_REPO reports $version, not $BUILT_AGAINST, and is not a git repository, so setup cannot switch it."
  if [ -n "$(git -C "$DSH_REPO" status --porcelain)" ]; then
    fail "the clone at $DSH_REPO reports $version, not $BUILT_AGAINST, and has uncommitted changes. Commit or stash them, then re-run."
  fi
  was="$(git -C "$DSH_REPO" rev-parse --abbrev-ref HEAD)"
  if [ "$was" = "HEAD" ]; then was="$(git -C "$DSH_REPO" rev-parse --short HEAD)"; fi
  echo "-- switching from $version ($was) to $DSH_REF; to go back: git -C $DSH_REPO checkout $was"
  # Only reach the network when the ref is not already in the clone, so an
  # offline machine with a complete clone still gets set up.
  if ! git -C "$DSH_REPO" rev-parse --verify --quiet "$DSH_REF^{commit}" >/dev/null; then
    git -C "$DSH_REPO" fetch --quiet --tags origin \
      || fail "$DSH_REF is not in $DSH_REPO and fetching from origin failed."
  fi
  git -C "$DSH_REPO" -c advice.detachedHead=false checkout --quiet "$DSH_REF" \
    || fail "could not check out $DSH_REF in $DSH_REPO"
  needs_build=1
  version="$(clone_version)"
  [ "$version" = "$BUILT_AGAINST" ] \
    || fail "after checking out $DSH_REF the clone reports $version, not $BUILT_AGAINST."
fi

if [ ! -d "$DSH_REPO/node_modules" ] || [ ! -f "$DSH_REPO/apps/cli/lib/bin.js" ]; then
  needs_build=1
fi
if [ "$needs_build" = "1" ]; then
  echo "-- pnpm install (the first run takes several minutes)"
  (cd "$DSH_REPO" && pnpm install)
  echo "-- pnpm run build"
  (cd "$DSH_REPO" && pnpm run build)
fi
[ -f "$DSH_REPO/apps/cli/lib/bin.js" ] \
  || fail "the clone did not build: $DSH_REPO/apps/cli/lib/bin.js is missing. In $DSH_REPO, run: pnpm install && pnpm run build"
echo "-- DSH $version at $DSH_REPO, installed and built"

echo "== 3/6 plugins -> profile '$PROFILE' ($PROFILE_DIR)"
# Remove the previous package name when upgrading an existing profile.
if [ -f "$PROFILE_DIR/package.json" ] && node -e '
    const manifest = require(process.argv[1])
    process.exit(manifest.dependencies?.[process.argv[2]] ? 0 : 1)
  ' "$PROFILE_DIR/package.json" "dsh-dirspawn"; then
  echo "-- removing the previous candidate builder package"
  dsh_clone plugin --profile "$PROFILE" remove dsh-dirspawn
fi
for pkg in "${PLUGINS[@]}"; do
  tgz="$KIT/dist/$pkg-0.1.0.tgz"
  if [ -f "$PROFILE_DIR/package.json" ] && node -e '
      const manifest = require(process.argv[1])
      process.exit(manifest.dependencies && manifest.dependencies[process.argv[2]] ? 0 : 1)
    ' "$PROFILE_DIR/package.json" "$pkg"; then
    echo "-- removing the installed $pkg"
    dsh_clone plugin --profile "$PROFILE" remove "$pkg"
  fi
  echo "-- adding $pkg"
  dsh_clone plugin --profile "$PROFILE" add "$tgz"
done

echo "== 4/6 benchmark sources and Python environment -> $BENCH_HOME"
mkdir -p "$BENCH_HOME"
pinned_clone "$FRONTIER_CS_DIR" "$FRONTIER_CS_REMOTE" "$FRONTIER_CS_REF"
pinned_clone "$ALE_BENCH_DIR" "$ALE_BENCH_REMOTE" "$ALE_BENCH_REF"
if [ ! -x "$BENCH_PY" ]; then
  echo "-- creating $BENCH_VENV"
  python -m venv "$BENCH_VENV" \
    || fail "could not create $BENCH_VENV. On Debian/Ubuntu: sudo apt install python3-venv"
fi
# Frontier-CS and ALE-Bench as their own READMEs install them, plus what the math
# evaluators and starting programs import.
echo "-- pip install (the first run takes several minutes)"
# Frontier-CS's skypilot dependency conflicts with ALE-Bench's pydantic-ai, and only its
# cloud backend uses it: Frontier-CS goes in without it, its other dependencies alongside.
frontier_deps="$("$BENCH_PY" -c 'import sys, tomllib
deps = tomllib.load(open(sys.argv[1], "rb"))["project"]["dependencies"]
print("\n".join(d for d in deps if not d.startswith("skypilot")))' "$FRONTIER_CS_DIR/pyproject.toml")"
mapfile -t frontier_deps <<< "$frontier_deps"
"$BENCH_PY" -m pip install --quiet --no-deps -e "$FRONTIER_CS_DIR"
"$BENCH_PY" -m pip install --quiet "$ALE_BENCH_DIR[eval]" "${frontier_deps[@]}" \
  numpy scipy matplotlib jax optax
"$BENCH_PY" -m pip freeze > "$BENCH_HOME/pip-freeze.txt"
echo "-- evaluator Python: $BENCH_PY ($("$BENCH_PY" --version 2>&1)); package versions in $BENCH_HOME/pip-freeze.txt"

echo "== 5/6 judges (Docker)"
echo "-- ALE-Bench execution images (the first build pulls and builds several images)"
(cd "$ALE_BENCH_DIR" && bash ./scripts/docker_build_all.sh "$(id -u)" "$(id -g)") \
  || fail "building the ALE-Bench images failed; see the docker output above."
echo "-- Frontier-CS judge -> $FRONTIER_CS_JUDGE"
# The judge image runs Node 20, and npm@latest no longer supports Node 20: npm 11 does.
sed -i 's/npm install -g npm@latest/npm install -g npm@11/' "$FRONTIER_CS_DIR/algorithmic/Dockerfile"
(cd "$FRONTIER_CS_DIR/algorithmic" && docker compose up -d --build) \
  || fail "the Frontier-CS judge did not start. It runs as a privileged container (go-judge), which Docker must allow."
judge_up() {
  "$BENCH_PY" -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1] + "/problems", timeout=5)' \
    "$FRONTIER_CS_JUDGE" >/dev/null 2>&1
}
for _ in $(seq 1 60); do judge_up && break; sleep 2; done
judge_up || fail "the Frontier-CS judge is not answering at $FRONTIER_CS_JUDGE/problems. See: cd $FRONTIER_CS_DIR/algorithmic && docker compose logs"

echo "== 6/6 verify"
grep -q "web_search" "$PROFILE_DIR/node_modules/dsh-candidate-builder/lib/index.js" \
  || fail "dsh-candidate-builder is not the kit version (no web restriction found)"
grep -q "candidate-builder" "$PROFILE_DIR/node_modules/dsh-candidate-builder/lib/index.js" \
  || fail "dsh-candidate-builder is not the kit version (provider name missing)"
grep -q "evolve_status" "$PROFILE_DIR/node_modules/dsh-evolve-loop/src/index.js" \
  || fail "dsh-evolve-loop is not the kit version (no evolve_status found)"
grep -q "get files()" "$PROFILE_DIR/node_modules/dsh-evolve-loop/src/evolve.js" \
  || fail "dsh-evolve-loop is not the kit version (no evolve.files rail found)"
grep -q "candidate-builder" "$PROFILE_DIR/node_modules/dsh-evolve-loop/src/providers/mutate.js" \
  || fail "dsh-evolve-loop is not the kit version (candidate-builder provider missing)"
node -e '
  const bundles = require(process.argv[1]).dsh?.profile?.bundles ?? []
  for (const name of ["dsh-candidate-builder", "dsh-evolve-loop"]) {
    if (!bundles.includes(name)) { console.error(`setup: ${name} is not listed in the profile bundles`); process.exit(1) }
  }
' "$PROFILE_DIR/package.json"
grep -q "evolve_activate" "$PROFILE_DIR/node_modules/dsh-evolve-loop/src/runtime.js" \
  || fail "dsh-evolve-loop is not the kit version (no runtime tools found)"
node -e '
  const patch = require(process.argv[1]).dsh?.bundle?.patch ?? []
  if (!patch.includes("./presets/evolve.patch.yml")) { console.error("setup: dsh-evolve-loop does not declare the Evolve preset"); process.exit(1) }
' "$PROFILE_DIR/node_modules/dsh-evolve-loop/package.json"
grep -q "id: evolve" "$PROFILE_DIR/node_modules/dsh-evolve-loop/presets/evolve.patch.yml" \
  || fail "the Evolve preset declaration is missing from dsh-evolve-loop"
[ -f "$PROFILE_DIR/node_modules/dsh-evolve-loop/skills/orchestrating-the-search/SKILL.md" ] \
  || fail "the Evolve skills are missing from dsh-evolve-loop"
if [ -d "$DSH_HOME/.agent-presets/evolve" ]; then
  echo "setup: note: $DSH_HOME/.agent-presets/evolve is left from an older kit. DSH 0.1.7 no longer reads that folder; Evolve Mode now comes from dsh-evolve-loop, so it can be deleted." >&2
fi
"$BENCH_PY" -c 'import numpy, scipy, matplotlib, jax, optax' \
  || fail "the math evaluator packages do not import in $BENCH_VENV"
"$BENCH_PY" -c 'import cairosvg' >/dev/null 2>&1 \
  || fail "cairosvg cannot load the cairo library, which ALE-Bench needs. On Debian/Ubuntu: sudo apt install libcairo2-dev libffi-dev"
"$BENCH_PY" -c 'from ale_bench.result import JudgeResult; from ale_bench_eval.safe_ale_session import start_ale_bench_session' \
  || fail "ale_bench / ale_bench_eval do not import in $BENCH_VENV; the ALE-Bench evaluators need both"
"$BENCH_PY" -c 'from frontier_cs.runner.base import EvaluationStatus; from frontier_cs.single_evaluator import SingleEvaluator' \
  || fail "frontier_cs does not import in $BENCH_VENV; the Frontier-CS evaluator needs it"
docker image inspect ale-bench:cpp20-202301 >/dev/null 2>&1 \
  || fail "the ALE-Bench C++20 image (ale-bench:cpp20-202301) is missing"

echo
echo "Ready. DSH $version at $DSH_REPO, plugins and the Evolve Mode preset in profile '$PROFILE'."
echo "Frontier-CS judge at $FRONTIER_CS_JUDGE (Docker restarts it; stop it with: cd $FRONTIER_CS_DIR/algorithmic && docker compose down)."
echo "The task evaluators run with 'python', so start DSH with the benchmark environment first on PATH:"
echo "  cd $DSH_REPO && PATH=\"$BENCH_VENV/bin:\$PATH\" DSH_HOME=$DSH_HOME pnpm dsh web"
echo "Then start a session with the \"Evolve Mode\" preset in a task folder."
echo "After a run on an ALE-Bench task, its final score (private evaluation): $BENCH_PY $KIT/final_eval.py <task folder>"
echo
echo "The prompt to give that session ($KIT/PROMPT.md):"
echo
cat "$KIT/PROMPT.md"
