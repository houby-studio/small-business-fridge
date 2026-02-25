# AGENTS.md

## Mandatory QA Before Marking Work Done

Before declaring any task complete, run the full quality gate from the repo root:

1. `npm run lint`
2. `npx prettier --check .`
3. `npm run typecheck`
4. `node ace migration:run --force` with test env (same as CI)
5. `node ace test --no-color` with test env
6. `npm run test:e2e`

Equivalent shortcut:

- `./check.sh` (covers lint, prettier, typecheck, migrations, unit/functional tests, e2e)

If any step fails:

- Fix the issue.
- Re-run failed checks and any dependent checks.
- Do not report completion until all checks pass.

## CI Parity Note

Mirror `.github/workflows/quality.yml` as the source of truth for required checks.

## CI Test Reporting Requirements

Every CI run must publish both test layers as JUnit checks and artifacts:

1. Japa report from `test-results/junit-japa.xml`
2. Playwright report from `test-results/junit-e2e.xml`
3. Upload raw test artifacts (`test-results/**`, `playwright-report/**`) for inspection

Treat missing or empty JUnit XML files as CI failures. Never leave publishing in a state that can show `0 ran` for passing suites.

## Test Creation Policy

For every feature or bugfix, add/update tests at all relevant levels:

- Unit tests for business logic changes.
- Functional (Japa) tests for route/controller/API behavior.
- Playwright e2e tests for user-visible flows and UI behavior.

UI-related changes (layout, navigation, breakpoints, visibility, overlays, interactions) must include or update Playwright coverage.
