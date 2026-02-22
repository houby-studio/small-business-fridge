# Deployment Guide

## Overview

Small Business Fridge is distributed as a Docker image (`houbystudio/sbf`) on Docker Hub.
The image ships with `.env.production` baked in, which reads sensitive values from Docker secrets.

### Environment variable source priority (highest → lowest)

1. `process.env` — values in compose `environment:` or a host `.env` file
2. `.env.production` — baked into the image; reads secrets via `file:` identifier
3. `.env` — local dev file (not present in the image)

Because `process.env` wins, you can always override any value by setting it in compose
`environment:`, even if a `file:` reference exists in `.env.production`.

---

## Quick start (simple — plain env vars)

Best for trying the app or small private deployments where secret exposure is acceptable.

**1. Copy the example env file:**

```bash
cp .env.example .env
# Edit .env and fill in at minimum: APP_KEY, DB_PASSWORD, SMTP_HOST, SMTP_PORT, SMTP_FROM_ADDRESS
```

**2. Generate an APP_KEY:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**3. Create a minimal compose override (`.env` values are read automatically by Docker Compose):**

Add the secrets to your `.env` file and ensure they appear in the compose `environment:` block,
or use the provided `compose.yml` with `${VAR}` substitution.

**4. Start:**

```bash
docker compose up -d
```

---

## Secure deployment (Docker secrets)

Recommended for production. Secret values never appear in `docker inspect`, compose logs, or
environment listings.

**1. Create the `secrets/` directory and populate secret files:**

```bash
# Required
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > secrets/app_key
printf 'your-db-password' > secrets/db_password

# Optional — only create files for features you use
printf 'your-smtp-password' > secrets/smtp_password
printf 'your-oidc-secret'   > secrets/oidc_client_secret
printf 'your-api-secret'    > secrets/api_secret

chmod 600 secrets/*
```

See [`secrets/README.md`](../secrets/README.md) for the full list of secrets.

**2. Start:**

```bash
docker compose up -d
```

The `compose.yml` mounts the `secrets/` files into containers. `.env.production` (baked
into the image) reads them via the `file:` identifier. No secrets appear in environment listings.

---

## Developer setup

For local development, run services via Docker Compose and the app directly with Node.

**1. Start infrastructure services (PostgreSQL, MailDev, pgAdmin):**

```bash
docker compose -f compose.dev.yml up -d
```

| Service  | URL / port                       |
| -------- | -------------------------------- |
| Postgres | `localhost:5433`                 |
| MailDev  | `http://localhost:8082` (web UI) |
| pgAdmin  | `http://localhost:8083`          |

**2. Copy and configure `.env`:**

```bash
cp .env.example .env
# Set: DB_PORT=5433, DB_USER=sbf, DB_PASSWORD=sbf, DB_DATABASE=sbf
# Set: APP_KEY=<generated value>
# Set: SMTP_HOST=localhost, SMTP_PORT=1026
```

**3. Install dependencies and start the dev server:**

```bash
npm install
node ace migration:run
node ace db:seed          # optional — creates dev users
npm run dev               # starts on http://localhost:3333
```

---

## Building from source

If you want to build the Docker image locally instead of pulling from Docker Hub:

```bash
docker compose -f compose.yml -f compose.build.yml up -d --build
```

The `compose.build.yml` override adds `build: .` to both `app` and `scheduler` services.
When both `image:` and `build:` are specified, Docker Compose builds from source and tags the
result with the `image:` name (`houbystudio/sbf:latest`).

---

## Environment variable reference

| Variable                       | Required | Secret | Default                 | Description                                 |
| ------------------------------ | -------- | ------ | ----------------------- | ------------------------------------------- |
| `APP_KEY`                      | Yes      | Yes    | —                       | Encryption/signing key (32+ random chars)   |
| `PORT`                         | Yes      | No     | `3000`                  | HTTP port                                   |
| `HOST`                         | Yes      | No     | `0.0.0.0`               | Bind address                                |
| `LOG_LEVEL`                    | No       | No     | `info`                  | trace/debug/info/warn/error/fatal           |
| `TZ`                           | No       | No     | `UTC`                   | Timezone (e.g. `Europe/Prague`)             |
| `APP_URL`                      | No       | No     | `http://localhost:3000` | Public URL (used in email links)            |
| `FEEDBACK_URL`                 | No       | No     | —                       | URL shown in feedback link                  |
| `SWAGGER_ENABLED`              | No       | No     | `false`                 | Enable Swagger UI at `/docs`                |
| `SESSION_DRIVER`               | Yes      | No     | `cookie`                | cookie or memory                            |
| `DB_HOST`                      | Yes      | No     | `postgres`              | PostgreSQL hostname                         |
| `DB_PORT`                      | Yes      | No     | `5432`                  | PostgreSQL port                             |
| `DB_USER`                      | Yes      | No     | `sbf`                   | PostgreSQL user                             |
| `DB_DATABASE`                  | Yes      | No     | `sbf`                   | PostgreSQL database name                    |
| `DB_PASSWORD`                  | No       | Yes    | —                       | PostgreSQL password                         |
| `SMTP_HOST`                    | Yes      | No     | —                       | SMTP server hostname                        |
| `SMTP_PORT`                    | Yes      | No     | `587`                   | SMTP server port                            |
| `SMTP_USERNAME`                | No       | No     | —                       | SMTP username (leave empty if no auth)      |
| `SMTP_PASSWORD`                | No       | Yes    | —                       | SMTP password                               |
| `SMTP_FROM_ADDRESS`            | Yes      | No     | `noreply@example.com`   | Sender address for outgoing mail            |
| `SMTP_FROM_NAME`               | Yes      | No     | `Lednice IT`            | Sender display name                         |
| `SMTP_IGNORE_TLS`              | No       | No     | `false`                 | Set true for plain SMTP without TLS         |
| `OIDC_ENABLED`                 | No       | No     | `false`                 | Enable OIDC (Microsoft Entra ID) login      |
| `OIDC_AUTO_REGISTER`           | No       | No     | `false`                 | Auto-create account on first OIDC login     |
| `LOCAL_LOGIN_DISABLED`         | No       | No     | `false`                 | Disable username/password login             |
| `OIDC_CLIENT_ID`               | No       | No     | —                       | Azure AD application (client) ID            |
| `OIDC_CLIENT_SECRET`           | No       | Yes    | —                       | Azure AD client secret                      |
| `OIDC_TENANT_ID`               | No       | No     | —                       | Azure AD tenant ID                          |
| `OIDC_REDIRECT_URI`            | No       | No     | —                       | OIDC callback URL                           |
| `API_SECRET`                   | No       | Yes    | —                       | Token for API authentication                |
| `CRON_DAILY_REPORT`            | No       | No     | `30 16 * * 1-5`         | Cron for daily report email                 |
| `CRON_UNPAID_REMINDER`         | No       | No     | `0 9 * * 1-5`           | Cron for unpaid invoice reminders           |
| `CRON_PENDING_APPROVAL`        | No       | No     | `0 9 * * 1-5`           | Cron for pending approval notifications     |
| `UNPAID_REMINDER_MIN_AGE_DAYS` | No       | No     | `3`                     | Min invoice age (days) before reminder sent |
| `OPENAI_API_KEY`               | No       | Yes    | —                       | OpenAI API key                              |
| `ESL_AIMS_ENABLED`             | No       | No     | `false`                 | Enable AIMS ESL integration                 |
| `ESL_AIMS_BASE_URL`            | No       | No     | —                       | AIMS base URL                               |
| `ESL_AIMS_STORE`               | No       | No     | —                       | AIMS store identifier                       |
| `ESL_AIMS_CRON`                | No       | No     | —                       | AIMS sync cron expression                   |
| `ESL_AIMS_VERIFY_TLS`          | No       | No     | `true`                  | Verify TLS for AIMS                         |
| `ESL_JAMES_ENABLED`            | No       | No     | `false`                 | Enable JAMES ESL integration                |
| `ESL_JAMES_BASE_URL`           | No       | No     | —                       | JAMES base URL                              |
| `ESL_JAMES_STORE`              | No       | No     | —                       | JAMES store identifier                      |
| `ESL_JAMES_API_KEY`            | No       | Yes    | —                       | JAMES API key                               |
| `ESL_JAMES_CRON`               | No       | No     | —                       | JAMES sync cron expression                  |
| `ESL_JAMES_VERIFY_TLS`         | No       | No     | `true`                  | Verify TLS for JAMES                        |

---

## NODE_ENV explanation

`NODE_ENV=production` is baked into the Docker image (`ENV NODE_ENV=production` in the Dockerfile).
This ensures:

- AdonisJS loads `.env.production` from the image (which contains the `file:` references)
- Production-optimised code paths are active (no source maps, no dev tools)
- The scheduler and app run in production mode without any compose configuration needed

You cannot override `NODE_ENV` from compose `environment:` when it is set via `ENV` in the
Dockerfile — this is intentional. In development you run `npm run dev` directly, not via Docker.
