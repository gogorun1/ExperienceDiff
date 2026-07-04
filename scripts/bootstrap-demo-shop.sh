#!/usr/bin/env bash
# Bootstraps apps/demo-shop as a NESTED, INDEPENDENT git repo from
# templates/demo-shop-seed. The main repo gitignores apps/demo-shop/.
#
# Creates branches: main (before baseline) + pr-a / pr-b / pr-c stubs.
# FE-1 owns implementing the actual PR changes on those branches.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED="$ROOT/templates/demo-shop-seed"
TARGET="$ROOT/apps/demo-shop"

if [ -d "$TARGET/.git" ]; then
  echo "apps/demo-shop already exists as a git repo — nothing to do."
  echo "To recreate from seed: rm -rf apps/demo-shop && npm run bootstrap:demo-shop"
  exit 0
fi

mkdir -p "$ROOT/apps"
rm -rf "$TARGET"
cp -R "$SEED" "$TARGET"

cd "$TARGET"
git init -b main
git add -A
git commit -m "demo-shop baseline: two-step checkout with 1.2s payment loading feedback"

# PR branch stubs — FE-1 implements the actual changes on each.
for branch in pr-a pr-b pr-c; do
  git branch "$branch" main
done

npm install --no-audit --no-fund

echo ""
echo "demo-shop bootstrapped at apps/demo-shop with branches: main, pr-a, pr-b, pr-c"
echo "  run it:        cd apps/demo-shop && PORT=3001 npm run dev"
echo "  FE-1 next:     implement PR-A/B/C changes on their branches (see apps/demo-shop/README.md)"
