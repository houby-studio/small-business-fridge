# Small Business Fridge

[![contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat)](https://github.com/houby-studio/small-business-fridge/issues)
[![GitHub license](https://img.shields.io/github/license/houby-studio/small-business-fridge)](https://github.com/houby-studio/small-business-fridge/blob/master/LICENSE)

**Small Business Fridge** is a system for sharing food and drinks with colleagues at cost — no profit.
Colleagues browse available products, buy with one click, then pay later via QR bank transfer.

## Stack

- **Backend**: AdonisJS 7 (Node.js 22+), PostgreSQL 18, Lucid ORM
- **Frontend**: Vue 3 + Inertia.js + PrimeVue
- **Auth**: Session-based (web) + token-based (API), optional OIDC (Microsoft Entra ID)
- **Language**: TypeScript throughout, Czech (cs) primary / English (en) secondary

## Developer quickstart

```bash
cp .env.example .env
npm install
node ace generate:key
docker compose -f compose.dev.yaml up -d
export NODE_ENV=development                  # tracking bug https://github.com/adonisjs/env/issues/48
node ace migration:run
node ace db:seed                             # creates admin / supplier / customer / kiosk seed users
npm run dev                                  # app at http://localhost:3333
```

Seed credentials: `admin / admin123`, `supplier / supplier123`, `customer / customer123`, `kiosk / kiosk123`.
Mailpit web UI: <http://localhost:8025>

## Production quickstart (Docker)

```bash
# 1. Prepare secrets
mkdir secrets
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > secrets/app_key
printf 'strong-db-password' > secrets/db_password
chmod 600 secrets/*

# 2. Set required env vars (export in shell or create .env next to compose.yaml)
#    APP_URL=https://your-domain.example.com
#    SMTP_HOST=smtp.your-provider.com  SMTP_PORT=587  SMTP_USERNAME=...

# 3. Start
docker compose up -d
docker compose exec app node ace migration:run
```

## Features

- Product catalog with category filtering and favorites
- One-click purchases (web + kiosk + mobile scanner)
- Order history and invoice management with QR payment generation
- Automatic payment reminders and daily purchase reports
- Supplier section: product management, stock, deliveries
- Admin section: user management, audit log, impersonation
- Kiosk mode: self-checkout via touchscreen keypad or barcode scanner
- OIDC single sign-on (Microsoft Entra ID) with auto-registration
- REST API for external integrations
- i18n: Czech and English

## License

MIT — see [LICENSE](LICENSE)
