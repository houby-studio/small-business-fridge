#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="$ROOT_DIR/.tmp/playwright-e2e.lock"

# Keep this in sync with playwright.config.ts / scripts/run_e2e.ts
E2E_PORT="${E2E_PORT:-3345}"

echo "Resetting Playwright E2E state..."

echo "1) Stopping stale Playwright / Adonis test server processes"
pkill -f "playwright test" >/dev/null 2>&1 || true
pkill -f "node ace serve" >/dev/null 2>&1 || true

echo "2) Removing E2E run lock"
rm -f "$LOCK_FILE"

echo "3) Releasing E2E port $E2E_PORT"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${E2E_PORT}/tcp" >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -ti "tcp:${E2E_PORT}" || true)"
  if [[ -n "$pids" ]]; then
    kill -9 $pids || true
  fi
fi

echo "4) Loading test environment"
set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/.env.test"
set +a

echo "5) Rebuilding test database schema"
(
  cd "$ROOT_DIR"
  node ace migration:fresh --force
)

echo "E2E state reset complete."
