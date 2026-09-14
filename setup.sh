#!/usr/bin/env bash
# Install the Evolve kit into a DeepSeek Harness home:
#   - the dsh-dirspawn and dsh-evolve-loop plugins, from dist/, into a profile
#   - the Evolve preset, from presets/evolve, into $DSH_HOME/.agent-presets/evolve
#
# Usage: bash setup.sh
# Environment: DSH_HOME (default ~/.dsh), PROFILE (default web)
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGINS=(dsh-dirspawn dsh-evolve-loop)

fail() { echo "setup: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found on PATH. $2"; }

echo "== 1/4 checks"
need node "Install Node.js 24 (the harness needs ^22.19.0 or >=24.0.0)."
need pnpm "Install pnpm 11.7.0, e.g.: npm install -g pnpm@11.7.0"
need dsh "Install the DeepSeek Harness CLI: npm install -g @deepseek-ai/dsh@0.1.2-rc.1"
need python "The evaluator is started as 'python'. On Debian/Ubuntu: sudo apt install python-is-python3"
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    console.error(`setup: Node ${process.version} is not supported; the harness needs ^22.19.0 or >=24.0.0`)
    process.exit(1)
  }
'
echo "node $(node -v) | pnpm $(pnpm -v) | $(python --version 2>&1) | dsh at $(command -v dsh)"
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
    dsh plugin --profile "$PROFILE" remove "$pkg"
  fi
  echo "-- adding $pkg"
  dsh plugin --profile "$PROFILE" add "$tgz"
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
echo "Ready. Restart DSH (dsh web), then start a session with the \"Evolve Mode\" preset in a task folder."
