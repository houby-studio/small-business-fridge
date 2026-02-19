# Small Business Fridge (SBF) - Gemini CLI Guide

I am your senior software engineering assistant, specialized in this AdonisJS + Vue + PrimeVue stack.

## MCP Capabilities

I have been configured with the following MCP servers:
- **Context7**: Advanced context management for Gemini CLI.
- **PrimeVue**: Direct access to PrimeVue component documentation and best practices.
- **AdonisJS**: Project-specific tools and insights (requires `npm run dev` to be running).
- **Playwright**: Browser automation and E2E test execution/debugging.
- **PostgreSQL**: Direct database access and schema exploration.

## Project Stack Reference
- **Backend**: AdonisJS 6 (Node.js 22+)
- **Frontend**: Vue 3 + Inertia.js + PrimeVue
- **Database**: PostgreSQL (Port 5433 in dev)
- **Style**: TailwindCSS 4 + PrimeVue Styled Mode

## Quality Gates
Always run `./check.sh` before finalizing any changes. It runs linting, formatting, type-checking, and tests.

## Common Commands
- `npm run dev`: Start development server with HMR.
- `node ace test`: Run Japa tests.
- `npm run test:e2e`: Run Playwright E2E tests.
- `node ace add <package>`: Add and configure an AdonisJS package.
