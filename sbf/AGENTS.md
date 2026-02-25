# AGENTS.md

## Mandatory QA Before Marking Work Done

Before declaring any task complete, run the full quality gate in `sbf/`:

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

Mirror `.github/workflows/sbf-quality.yml` as the source of truth for required checks.

## Test Creation Policy

For every feature or bugfix, add/update tests at all relevant levels:

- Unit tests for business logic changes.
- Functional (Japa) tests for route/controller/API behavior.
- Playwright e2e tests for user-visible flows and UI behavior.

UI-related changes (layout, navigation, breakpoints, visibility, overlays, interactions) must include or update Playwright coverage.
