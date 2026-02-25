#!/usr/bin/env bash
# check.sh — Run all quality gates
# Usage: ./check.sh [--skip-tests]
#
# Requires: PostgreSQL running on localhost:5433
#   Start with: docker compose -f compose.dev.yaml up -d postgres

set -euo pipefail

SKIP_TESTS=false
for arg in "$@"; do
  [[ "$arg" == "--skip-tests" ]] && SKIP_TESTS=true
done

PASS="\033[0;32m✔\033[0m"
FAIL="\033[0;31m✖\033[0m"
STEP="\033[0;34m»\033[0m"

run_step() {
  local label="$1"
  shift
  echo -e "\n${STEP} ${label}..."
  if "$@"; then
    echo -e "${PASS} ${label} passed"
  else
    echo -e "${FAIL} ${label} FAILED"
    exit 1
  fi
}

echo "================================================"
echo "  SBF Quality Gate"
echo "================================================"

run_step "ESLint"         npm run lint
run_step "Prettier"       npx prettier --check .
run_step "TypeScript"     npm run typecheck

if [[ "$SKIP_TESTS" == true ]]; then
  echo -e "\n\033[0;33m⚠ Tests skipped (--skip-tests)\033[0m"
else
  TEST_ENV=(
    TZ=UTC
    NODE_ENV=test
    APP_KEY=test-app-key-for-ci-only-123456789
    DB_HOST=127.0.0.1
    DB_PORT=5433
    DB_USER=sbf
    DB_PASSWORD=sbf
    DB_DATABASE=sbf_test
    SESSION_DRIVER=memory
    LOG_LEVEL=error
    SMTP_HOST=localhost
    SMTP_PORT=1025
    OIDC_ENABLED=false
    API_SECRET=test-api-secret
    APP_URL=http://localhost:3334
  )

  run_step "Test migrations" env "${TEST_ENV[@]}" node ace migration:run --force
  run_step "Unit + Functional tests" env "${TEST_ENV[@]}" node ace test --no-color
  run_step "Playwright E2E tests" npm run test:e2e
fi

echo ""
echo "================================================"
echo -e "  ${PASS} All checks passed!"
echo "================================================"
