# AGENTS.md

## Mandatory QA Before Marking Work Done

Before declaring any task complete, run the full quality gate in `sbf/`:

1. `npm run lint`
2. `npx prettier --check .`
3. `npm run typecheck`
4. `node ace migration:run --force` with test env (same as CI)
5. `node ace test --no-color` with test env

Equivalent shortcut:

- `./check.sh` (covers lint, prettier, typecheck, tests)

If any step fails:

- Fix the issue.
- Re-run failed checks and any dependent checks.
- Do not report completion until all checks pass.

## CI Parity Note

Mirror `.github/workflows/sbf-quality.yml` as the source of truth for required checks.
