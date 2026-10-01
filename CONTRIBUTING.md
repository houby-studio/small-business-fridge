# Contributing to Fridgora

Thanks for wanting to help! Bug reports, ideas, translations, docs and code are all welcome.

## Before you start

- **Bugs and ideas** — open an [issue](https://github.com/houby-studio/fridgora/issues). For
  anything bigger than a small fix, please describe the change there first, so we can agree on the
  approach before you spend time on it.
- **Security issues** — never in a public issue. See [SECURITY.md](SECURITY.md).
- Please follow the [code of conduct](CODE_OF_CONDUCT.md) in every interaction.

## Setting up

The [README](README.md#-development) gets a development instance running in a few minutes. You need
Node.js 24 and Docker (for PostgreSQL and Mailpit).

## Making a change

1. Branch from `master` and keep the pull request focused on one thing.
2. Add or update tests at every level the change touches:
   - **unit** (`tests/unit/`) for business logic,
   - **functional** (`tests/functional/`) for routes, controllers and the API,
   - **end-to-end** (`tests/e2e/`, Playwright) for anything a user can see or click.

   A bug fix comes with a test that fails without it.
3. User-facing text goes into **both** `resources/lang/cs/` and `resources/lang/en/`.
4. Changing a backend validator? Update the matching client-side check in
   `inertia/composables/use_*_form_validation.ts` too.
5. Run the full quality gate — the same one CI runs — and make it green:

   ```bash
   ./check.sh
   ```

The conventions (UI components, button styles, dialogs, tables, audit log, framework gotchas)
are written down in [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md). They are meant for AI
coding assistants and humans alike.

## Pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `ci:`, `chore:` …
- Describe **what** changed and **why**, and how you tested it. Screenshots help for UI changes.
- CI must pass. A pull request from this repository also gets a Docker image of its own, handy
  for trying the change out.
