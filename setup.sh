#!/usr/bin/env bash
# Install the Evolve kit into a DeepSeek Harness home, using a DSH source clone:
#   - the dsh-dirspawn and dsh-evolve-loop plugins, from dist/, into a profile
#   - the Evolve preset, from presets/evolve, into $DSH_HOME/.agent-presets/evolve
#
# Usage: DSH_REPO=/path/to/deepseek-harness bash setup.sh
# Environment: DSH_REPO (default ~/deepseek-harness), DSH_HOME (default ~/.dsh), PROFILE (default web)
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_REPO="${DSH_REPO:-$HOME/deepseek-harness}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGINS=(dsh-dirspawn dsh-evolve-loop)
BUILT_AGAINST="0.1.2-rc.1"

fail() { echo "setup: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found on PATH. $2"; }
# Run the clone's own CLI, exactly as `pnpm dsh ...` from the clone.
dsh_clone() { (cd "$DSH_REPO" && pnpm dsh "$@"); }

echo "== 1/4 checks"
need node "Install Node.js 24 (the harness needs ^22.19.0 or >=24.0.0)."
need pnpm "Install pnpm 11.7.0, e.g.: npm install -g pnpm@11.7.0"
need python "The evaluator is started as 'python'. On Debian/Ubuntu: sudo apt install python-is-python3"
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    console.error(`setup: Node ${process.version} is not supported; the harness needs ^22.19.0 or >=24.0.0`)
    process.exit(1)
  }
'
[ -f "$DSH_REPO/apps/cli/package.json" ] \
  || fail "no DeepSeek Harness clone at $DSH_REPO. Set DSH_REPO=/path/to/deepseek-harness"
[ -d "$DSH_REPO/node_modules" ] && [ -f "$DSH_REPO/apps/cli/lib/bin.js" ] \
  || fail "the clone at $DSH_REPO is not installed and built. In it, run: pnpm install && pnpm run build"
DSH_VERSION="$(node -p 'require(process.argv[1]).version' "$DSH_REPO/apps/cli/package.json")"
echo "node $(node -v) | pnpm $(pnpm -v) | $(python --version 2>&1) | DSH clone $DSH_VERSION at $DSH_REPO"
if [ "$DSH_VERSION" != "$BUILT_AGAINST" ]; then
  echo "setup: warning: the plugins were built against DSH $BUILT_AGAINST and your clone is $DSH_VERSION. Run the README checks after setup." >&2
fi
if command -v dsh >/dev/null 2>&1; then
  echo "setup: warning: another 'dsh' is on your PATH ($(command -v dsh)). Start DSH from the clone (pnpm dsh web), or that one may run instead." >&2
fi
if command -v bwrap >/dev/null 2>&1; then
  echo "sandbox: bwrap found"
else
  echo "setup: warning: bwrap not found. DSH will try its Landlock launcher; if that also fails, sandboxed commands refuse to run. Recommended: sudo apt install bubblewrap" >&2
fi

echo "== 2/4 plugins -> profile '$PROFILE' ($PROFILE_DIR)"
for pkg in "${PLUGINS[@]}"; do
  tgz="$KIT/dist/$pkg-0.1.0.tgz"
  [ -f "$tgz" ] || fail "missing $tgz"
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

echo "== 3/4 preset -> $DSH_HOME/.agent-presets/evolve"
PRESETS="$DSH_HOME/.agent-presets"
mkdir -p "$PRESETS"
if [ -d "$PRESETS/evolve" ]; then
  # Kept outside .agent-presets: DSH lists every directory there as a preset.
  backup="$DSH_HOME/.agent-presets-backup/evolve-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$(dirname "$backup")"
  mv "$PRESETS/evolve" "$backup"
  echo "-- previous preset moved to $backup"
fi
cp -R "$KIT/presets/evolve" "$PRESETS/evolve"

echo "== 4/4 verify"
grep -q "web_search" "$PROFILE_DIR/node_modules/dsh-dirspawn/lib/index.js" \
  || fail "dsh-dirspawn is not the kit version (no web restriction found)"
grep -q "evolve_status" "$PROFILE_DIR/node_modules/dsh-evolve-loop/src/index.js" \
  || fail "dsh-evolve-loop is not the kit version (no evolve_status found)"
node -e '
  const bundles = require(process.argv[1]).dsh?.profile?.bundles ?? []
  for (const name of ["dsh-dirspawn", "dsh-evolve-loop"]) {
    if (!bundles.includes(name)) { console.error(`setup: ${name} is not listed in the profile bundles`); process.exit(1) }
  }
' "$PROFILE_DIR/package.json"
[ -f "$PRESETS/evolve/agent.cordis.yml" ] && [ -f "$PRESETS/evolve/preset.yml" ] \
  || fail "the Evolve preset was not copied"

echo
echo "Ready. Restart DSH from the clone (cd $DSH_REPO && pnpm dsh web), then start a session with the \"Evolve Mode\" preset in a task folder."
