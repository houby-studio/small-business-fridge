# AGENTS.md

## Mandatory QA Before Marking Work Done

Before declaring any task complete, run the full quality gate from the repo root:

1. `npm run lint`
2. `npx prettier --check .`
3. `npm run typecheck`
4. `node ace migration:run --force` with test env (same as CI)
5. `node ace test --no-color` with test env
6. `npm run test:e2e`

Equivalent shortcuts:

- `./check.sh` (covers lint, prettier, typecheck, migrations, unit/functional tests, e2e)
- `.\check.ps1` (PowerShell alternative with the same checks)

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

## Form UX and Validation Standards

Apply these standards to all user-management flows (authentication, invitation, profile/account settings, and admin user actions with free-text input):

1. Validation layering (mandatory):

- Enforce server-side validation in controllers/validators for every input.
- Mirror critical constraints on the client (required fields, min lengths, basic format checks) to prevent avoidable submits.

2. Submit guard (mandatory):

- Primary submit buttons for free-input forms must be disabled when client-side validation fails or while the request is processing.
- Do not rely only on server rejection for obviously invalid payloads.

3. Error visibility (mandatory):

- Surface backend validation and error flashes to users in the UI.
- Global flash rendering must include structured validation payloads (`errorsBag`, `inputErrorsBag`) in addition to generic alerts.
- Field-level errors should be visible near related inputs when available.

4. Inline hints (mandatory):

- Show concise, contextual validation hints under inputs for active client-side violations (e.g., invalid email, min length, password mismatch).

5. Alternative navigation (mandatory for auth-like forms):

- Guest/auth forms should include a small secondary link under the main submit action for common alternative flows (e.g., back to login, register instead, forgot password).

6. Testing requirements for form changes:

- Unit: cover shared form/flash mapping logic when introduced.
- Functional: include valid and invalid submissions; assert guards prevent unsafe state changes.
- E2E: verify disabled/enabled submit behavior and visible user feedback for invalid and valid flows.
