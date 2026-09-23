#!/usr/bin/env bash
# Install the Evolve kit into a DeepSeek Harness home, using a DSH source clone:
#   - checks the prerequisites (node, pnpm, git, python 3, bwrap)
#   - clones, pins and builds the DSH clone when it is missing or on another version
#   - installs the dsh-dirspawn and dsh-evolve-loop plugins, from dist/, into a profile
#   - installs the Evolve preset, from presets/evolve, into $DSH_HOME/.agent-presets/evolve
#
# Usage: bash setup.sh
# Environment: DSH_REPO (default ~/deepseek-harness), DSH_HOME (default ~/.dsh),
#              PROFILE (default web), DSH_REMOTE, DSH_REF
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_REPO="${DSH_REPO:-$HOME/deepseek-harness}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGINS=(dsh-dirspawn dsh-evolve-loop)
# The harness version the plugins and the preset were built and tested against,
# and the tag that carries it. dsh-dirspawn uses the 0.1.5 agent factory
# (setup(childCtx, child) and parentAgent) and the preset's persona row uses the
# 0.1.5 prefix/suffix form, so an older clone does not run this kit.
BUILT_AGAINST="0.1.5-rc.2"
DSH_REMOTE="${DSH_REMOTE:-https://github.com/deepseek-ai/deepseek-harness.git}"
DSH_REF="${DSH_REF:-dsh-v0.1.5-rc.2}"

fail() { echo "setup: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found on PATH. $2"; }
# Run the clone's own CLI, exactly as `pnpm dsh ...` from the clone.
dsh_clone() { (cd "$DSH_REPO" && pnpm dsh "$@"); }
clone_version() { node -p 'require(process.argv[1]).version' "$DSH_REPO/apps/cli/package.json"; }

echo "== 1/5 checks"
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
echo "node $(node -v) | pnpm $(pnpm -v) | $(python --version 2>&1) | git $(git --version | awk '{print $3}')"
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

echo "== 2/5 DSH clone -> $DSH_REPO (kit targets $BUILT_AGAINST)"
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

echo "== 3/5 plugins -> profile '$PROFILE' ($PROFILE_DIR)"
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

echo "== 4/5 preset -> $DSH_HOME/.agent-presets/evolve"
PRESETS="$DSH_HOME/.agent-presets"
mkdir -p "$PRESETS"
if [ -d "$PRESETS/evolve" ]; then
  # Kept outside .agent-presets: DSH lists every directory there as a preset.
  backup="$DSH_HOME/.agent-presets-backup/evolve-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$(dirname "$backup")"
  mv "$PRESETS/evolve" "$backup" \
    || fail "could not move the installed preset to $backup. A running DSH can hold that folder open — stop DSH and run setup.sh again."
  echo "-- previous preset moved to $backup"
fi
cp -R "$KIT/presets/evolve" "$PRESETS/evolve"

echo "== 5/5 verify"
grep -q "web_search" "$PROFILE_DIR/node_modules/dsh-dirspawn/lib/index.js" \
  || fail "dsh-dirspawn is not the kit version (no web restriction found)"
grep -q "evolve_status" "$PROFILE_DIR/node_modules/dsh-evolve-loop/src/index.js" \
  || fail "dsh-evolve-loop is not the kit version (no evolve_status found)"
grep -q "get files()" "$PROFILE_DIR/node_modules/dsh-evolve-loop/src/evolve.js" \
  || fail "dsh-evolve-loop is not the kit version (no evolve.files rail found)"
node -e '
  const bundles = require(process.argv[1]).dsh?.profile?.bundles ?? []
  for (const name of ["dsh-dirspawn", "dsh-evolve-loop"]) {
    if (!bundles.includes(name)) { console.error(`setup: ${name} is not listed in the profile bundles`); process.exit(1) }
  }
' "$PROFILE_DIR/package.json"
[ -f "$PRESETS/evolve/agent.cordis.yml" ] && [ -f "$PRESETS/evolve/preset.yml" ] \
  || fail "the Evolve preset was not copied"

echo
echo "Ready. DSH $version at $DSH_REPO, plugins in profile '$PROFILE', preset in $PRESETS/evolve."
echo "Start DSH from the clone: cd $DSH_REPO && DSH_HOME=$DSH_HOME pnpm dsh web"
echo "Then start a session with the \"Evolve Mode\" preset in a task folder."
echo
echo "The prompt to give that session ($KIT/PROMPT.md):"
echo
cat "$KIT/PROMPT.md"
