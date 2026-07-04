#!/usr/bin/env bash
# Bootstraps apps/demo-shop (nested, independent git repo — gitignored by the
# main repo) by cloning the shared demo corpus repo:
#
#   git@github.com:gogorun1/Cursor_user_journey_demo.git
#   branches: main (before baseline) + pr-a / pr-b / pr-c
#
# Falls back to templates/demo-shop-seed if the clone fails (offline etc).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED="$ROOT/templates/demo-shop-seed"
TARGET="$ROOT/apps/demo-shop"
REMOTE="${DEMO_SHOP_REMOTE:-git@github.com:gogorun1/Cursor_user_journey_demo.git}"

if [ -d "$TARGET/.git" ]; then
  echo "apps/demo-shop already exists — pulling latest branches instead."
  cd "$TARGET"
  git fetch origin --prune
  for branch in main pr-a pr-b pr-c; do
    git branch --track "$branch" "origin/$branch" 2>/dev/null || true
  done
  git pull --ff-only || true
  exit 0
fi

mkdir -p "$ROOT/apps"

if git clone "$REMOTE" "$TARGET"; then
  cd "$TARGET"
  for branch in pr-a pr-b pr-c; do
    git branch --track "$branch" "origin/$branch" 2>/dev/null || true
  done
  echo "cloned $REMOTE"
else
  echo "clone failed — falling back to local seed (no remote, FE-1 work can't be shared this way)"
  rm -rf "$TARGET"
  cp -R "$SEED" "$TARGET"
  cd "$TARGET"
  git init -b main
  git add -A
  git commit -m "demo-shop baseline: two-step checkout with 1.2s payment loading feedback"
  for branch in pr-a pr-b pr-c; do
    git branch "$branch" main
  done
fi

npm install --no-audit --no-fund

echo ""
echo "demo-shop ready at apps/demo-shop with branches: main, pr-a, pr-b, pr-c"
echo "  run it:    cd apps/demo-shop && PORT=3001 npm run dev"
echo "  FE-1:      implement PR changes on pr-a/pr-b/pr-c and push (see apps/demo-shop/README.md)"
