#!/usr/bin/env bash
# Idempotent cleanup: kill dev servers on pipeline ports, remove worktrees.
set -uo pipefail

for port in 3001 3002; do
  pid=$(lsof -ti tcp:"$port" || true)
  if [ -n "$pid" ]; then
    echo "killing process on port $port (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done

HERE="$(cd "$(dirname "$0")" && pwd)"
DEMO_SHOP="$HERE/../../apps/demo-shop"

if [ -d "$DEMO_SHOP/.git" ]; then
  (cd "$DEMO_SHOP" && git worktree prune) || true
fi
rm -rf "$HERE/.worktrees"
echo "pipeline cleanup done"
