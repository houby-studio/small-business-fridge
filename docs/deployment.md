# Deployment Guide

## Overview

Fridgora is distributed as a Docker image (`houbystudio/fridgora`) on Docker Hub.
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
or use the provided `compose.yaml` with `${VAR}` substitution.

**4. Start:**

```bash
docker compose up -d
```

---

## Secure deployment (Docker secrets)

Recommended for production. Secret values never appear in `docker inspect`, compose logs, or
environment listings.

**1. Create the `.secrets/` directory and populate secret files:**

```bash
# Required
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > .secrets/app_key
printf 'your-db-password' > .secrets/db_password

# Optional — only create files for features you use
printf 'your-smtp-password' > .secrets/smtp_password
printf 'your-oidc-secret'   > .secrets/oidc_client_secret
printf 'your-api-secret'    > .secrets/api_secret

chmod 600 .secrets/*
```

See [`secrets/README.md`](../secrets/README.md) for the full list of secrets.

**2. Start:**

```bash
docker compose up -d
```

The `compose.yaml` mounts the `secrets/` files into containers. `.env.production` (baked
into the image) reads them via the `file:` identifier. No secrets appear in environment listings.

---

## Developer setup

For local development, run services via Docker Compose and the app directly with Node.

**1. Start infrastructure services (PostgreSQL, Mailpit, pgAdmin):**

```bash
docker compose -f compose.dev.yaml up -d
```

| Service  | URL / port                       |
| -------- | -------------------------------- |
| Postgres | `localhost:5432`                 |
| Mailpit  | `http://localhost:8025` (web UI) |
| pgAdmin  | `http://localhost:8080`          |

**2. Copy and configure `.env`:**

```bash
cp .env.example .env
# Set: DB_PORT=5432, DB_USER=sbf, DB_PASSWORD=sbf, DB_DATABASE=sbf
# Set: APP_KEY=<generated value>
# Set: SMTP_HOST=localhost, SMTP_PORT=1025
```

**3. Install dependencies and start the dev server:**

```bash
npm install
node ace migration:run
node ace db:seed          # optional — creates dev users
npm run dev               # starts on http://localhost:3000
```

---

## Building from source

If you want to build the Docker image locally instead of pulling from Docker Hub:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

The `compose.build.yaml` override adds `build: .` to both `app` and `scheduler` services.
When both `image:` and `build:` are specified, Docker Compose builds from source and tags the
result with the `image:` name (`houbystudio/fridgora:latest`).

---

## Cutting a release

Releases are plain semver git tags (`1.0.0`, `2.2.0`, `3.0.0`). Everything downstream is
automated; you only choose the number.

```bash
npm version patch   # or minor / major
git push --follow-tags
```

`npm version` bumps `package.json`, commits, and creates the tag. `.npmrc` keeps the tag
bare so it matches the tags this repo already carries.

Pushing the tag runs CI on the tagged commit first. Only once every gate is green does CI call
`docker-image.yml` (a reusable workflow, in the same run), and it:

1. builds the image and pushes `houbystudio/fridgora:<version>`, `:latest` and `:<commit sha>`,
2. bakes the version, commit and build date into the image as env vars and OCI labels,
3. signs a [build provenance attestation](#verifying-an-image) for the image digest,
4. creates a GitHub Release with notes generated from the merged pull requests.

### What `latest` means

`latest` is the newest **release**, never the tip of a branch. That is what a fresh
`docker compose up -d` pulls with the default tag in `compose.yaml`. Branch builds get
`:master` or `:<branch-name>` instead, plus an immutable `:<commit sha>`.

In production, pin the version tag rather than `latest`, so a rollback is deterministic:

```bash
DOCKER_IMAGE_TAG=3.0.0
```

### Which build is running

Three ways, no guessing:

```bash
# from the image, without starting anything
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' houbystudio/fridgora:latest

# from a running container
docker exec <container> printenv APP_VERSION GIT_SHA BUILD_DATE
```

Signed-in users see it in the footer of every page. It is deliberately **not** on
`/api/v1/health`, which is unauthenticated and usually internet-facing.

A build that was not produced by the release workflow reports itself as `dev`.

### Verifying an image

Every image CI publishes carries a signed [SLSA build provenance](https://slsa.dev/provenance)
attestation: a statement that this exact digest was built by `docker-image.yml` in this
repository, from a given commit and ref, in a given workflow run. It is signed with a
short-lived Sigstore certificate tied to that workflow, so nobody can forge one — not even with
the Docker Hub credentials. An image pushed by hand, or with a leaked token, simply has none.

Verify before deploying (needs the [GitHub CLI](https://cli.github.com/), signed in):

```bash
gh attestation verify oci://docker.io/houbystudio/fridgora:3.2.2 \
  --repo houby-studio/fridgora \
  --signer-workflow houby-studio/fridgora/.github/workflows/docker-image.yml \
  --source-ref refs/tags/3.2.2
```

- `--repo` alone proves the image came from this repository's Actions.
- `--signer-workflow` additionally requires the release workflow, not some other workflow here.
- `--source-ref` pins the ref: `refs/tags/<version>` for a release, `refs/heads/master` for
  `:master`. Pull request images are attested too, with `refs/pull/<n>/merge` — leave the flag
  out or match that, but never deploy one to production.
- Without a GitHub login, add `--bundle-from-oci` to read the attestation from Docker Hub instead
  of the GitHub API.

A tag can be moved, so for an unattended deploy verify the **digest** you are about to run
(`oci://docker.io/houbystudio/fridgora@sha256:…`) and deploy that same digest. A non-zero exit code
means: do not deploy.

Releases up to and including 3.2.1 were published before attestations existed, as
`houbystudio/sbf`, and have none.

The kiosk snap built on `master` is attested as well: unzip the workflow artifact and run
`gh attestation verify <file>.snap --repo houby-studio/fridgora`.

### Moving from `houbystudio/sbf` to `houbystudio/fridgora`

The project was renamed from _Small Business Fridge_ to **Fridgora** after 3.2.1. Everything after
that is published only as `houbystudio/fridgora`; the old `houbystudio/sbf` repository keeps its
tags (up to 3.2.1) but receives no updates.

1. In your `compose.yaml`, change `image: houbystudio/sbf:…` to `image: houbystudio/fridgora:…`
   for both `app` and `scheduler` (or download the current `compose.yaml`).
2. `docker compose pull && docker compose up -d`.

Nothing else changes: the database, volumes, `.env`, sessions and installed kiosks keep working
as they are. The default `APP_NAME` is now `Fridgora` — set `APP_NAME` if you want to keep your
own name in the UI and emails.

### Upgrading to 3.1

- **Back up the database first.** `add_unit_price_to_orders` backfills a price onto every
  existing order. The 3.1 migrations are forward-only in practice: rolling them back drops the
  per-order price, and the 3.0 code would then read corrected delivery prices into invoices
  that were already issued.
- **Keypad IDs:** users are never assigned `666` (kiosk easter egg) or a numeric
  `KIOSK_LOGOUT_CODE` any more, but existing assignments are not changed. Check once:
  `SELECT id, display_name, keypad_id FROM users WHERE keypad_id = 666;` and reassign.
- **Behaviour changes for API clients** (scanner firmware, integrations):
  - `POST /api/v1/orders` sells from the **oldest** in-stock lot of the product, whichever
    `deliveryId` is sent. Send `expectedPrice` (the price shown to the buyer): if the lot
    sold next costs anything else, nothing is bought and `409` is returned.
  - Order responses carry `unitPrice` — what that unit cost. `delivery.price` is the lot's
    current price, which a supplier may have corrected since.
- **MCP clients** (e.g. Claude) show a consent page the first time they connect.

---

## Environment variable reference

| Variable                                | Required | Secret | Default                 | Description                                                       |
| --------------------------------------- | -------- | ------ | ----------------------- | ----------------------------------------------------------------- |
| `APP_KEY`                               | Yes      | Yes    | —                       | Encryption/signing key (32+ random chars)                         |
| `PORT`                                  | Yes      | No     | `3000`                  | HTTP port                                                         |
| `HOST`                                  | Yes      | No     | `0.0.0.0`               | Bind address                                                      |
| `LOG_LEVEL`                             | No       | No     | `info`                  | trace/debug/info/warn/error/fatal                                 |
| `TZ`                                    | No       | No     | `UTC`                   | Timezone (e.g. `Europe/Prague`)                                   |
| `APP_NAME`                              | No       | No     | `Fridgora` | App brand name used in UI/emails/API docs                         |
| `APP_URL`                               | No       | No     | `http://localhost:3000` | Public URL (used in email links)                                  |
| `FEEDBACK_URL`                          | No       | No     | —                       | URL shown in feedback link                                        |
| `SWAGGER_ENABLED`                       | No       | No     | `false`                 | Enable Swagger UI at `/docs`                                      |
| `SESSION_DRIVER`                        | Yes      | No     | `cookie`                | cookie or memory                                                  |
| `DB_HOST`                               | Yes      | No     | `postgres`              | PostgreSQL hostname                                               |
| `DB_PORT`                               | Yes      | No     | `5432`                  | PostgreSQL port                                                   |
| `DB_USER`                               | Yes      | No     | `sbf`                   | PostgreSQL user                                                   |
| `DB_DATABASE`                           | Yes      | No     | `sbf`                   | PostgreSQL database name                                          |
| `DB_PASSWORD`                           | No       | Yes    | —                       | PostgreSQL password                                               |
| `SMTP_HOST`                             | Yes      | No     | —                       | SMTP server hostname                                              |
| `SMTP_PORT`                             | Yes      | No     | `587`                   | SMTP server port                                                  |
| `SMTP_USERNAME`                         | No       | No     | —                       | SMTP username (leave empty if no auth)                            |
| `SMTP_PASSWORD`                         | No       | Yes    | —                       | SMTP password                                                     |
| `SMTP_FROM_ADDRESS`                     | Yes      | No     | `noreply@example.com`   | Sender address for outgoing mail                                  |
| `SMTP_FROM_NAME`                        | Yes      | No     | `Fridgora` | Sender display name                                               |
| `SMTP_IGNORE_TLS`                       | No       | No     | `false`                 | Set true for plain SMTP without TLS                               |
| `AUTH_PROVIDERS`                        | No       | No     | `local`                 | Comma-separated providers (`local`, `microsoft`, `discord`)       |
| `AUTH_AUTO_REGISTER_PROVIDERS`          | No       | No     | —                       | Comma list for auto-provisioning (`microsoft`, `discord`)         |
| `AUTH_REGISTRATION_MODE`                | No       | No     | `open`                  | Self-signup policy (`open`, `invite_only`, `domain_auto_approve`) |
| `AUTH_REGISTRATION_ALLOWED_DOMAINS`     | No       | No     | —                       | Domain allowlist for `domain_auto_approve`                        |
| `INVITE_EXPIRY_HOURS`                   | No       | No     | `168`                   | Invite-link validity window in hours                              |
| `PASSWORD_RESET_TTL_MINUTES`            | No       | No     | `60`                    | Password reset link validity in minutes                           |
| `AUTH_PROVIDER_MICROSOFT_CLIENT_ID`     | No       | No     | —                       | Microsoft Entra application (client) ID                           |
| `AUTH_PROVIDER_MICROSOFT_CLIENT_SECRET` | No       | Yes    | —                       | Microsoft Entra client secret                                     |
| `AUTH_PROVIDER_MICROSOFT_TENANT_ID`     | No       | No     | `common`                | Microsoft Entra tenant ID                                         |
| `AUTH_PROVIDER_MICROSOFT_REDIRECT_URI`  | No       | No     | —                       | Microsoft callback URL                                            |
| `AUTH_PROVIDER_DISCORD_CLIENT_ID`       | No       | No     | —                       | Discord application client ID                                     |
| `AUTH_PROVIDER_DISCORD_CLIENT_SECRET`   | No       | Yes    | —                       | Discord application client secret                                 |
| `AUTH_PROVIDER_DISCORD_REDIRECT_URI`    | No       | No     | —                       | Discord callback URL                                              |
| `AUTH_PROVIDER_DISCORD_SCOPES`          | No       | No     | `identify,email`        | Discord OAuth scopes                                              |
| `API_SECRET`                            | No       | Yes    | —                       | Token for API authentication                                      |
| `CRON_DAILY_REPORT`                     | No       | No     | `30 16 * * 1-5`         | Cron for daily report email                                       |
| `CRON_UNPAID_REMINDER`                  | No       | No     | `0 9 * * 1-5`           | Cron for unpaid invoice reminders                                 |
| `CRON_PENDING_APPROVAL`                 | No       | No     | `0 9 * * 1-5`           | Cron for pending approval notifications                           |
| `UNPAID_REMINDER_MIN_AGE_DAYS`          | No       | No     | `3`                     | Min invoice age (days) before reminder sent                       |
| `PRODUCT_IMAGE_REMBG_URL` | No | No | — | Optional rembg sidecar for background removal |
| `PRODUCT_IMAGE_REMBG_MODEL` | No | No | `birefnet-general` | rembg model name |
| `PRODUCT_IMAGE_CLOUDFLARE_URL` | No | No | — | Cloudflare background-removal Worker |
| `PRODUCT_IMAGE_CLOUDFLARE_TOKEN` | No | Yes | — | Bearer token for that Worker |
| `PRODUCT_AI_ENDPOINT` | No | No | — | Azure OpenAI / Foundry endpoint for product-form suggestions |
| `PRODUCT_AI_CLIENT_SECRET` | No | Yes | — | Entra service principal secret (or `PRODUCT_AI_API_KEY`) |
| `PRODUCT_IMAGE_OPENFOODFACTS_ENABLED` | No | No | `true` | Picture lookup by barcode |

All product image settings: [docs/product-images.md](product-images.md).

---

## NODE_ENV explanation

`NODE_ENV=production` is baked into the Docker image (`ENV NODE_ENV=production` in the Dockerfile).
This ensures:

- AdonisJS loads `.env.production` from the image (which contains the `file:` references)
- Production-optimised code paths are active (no source maps, no dev tools)
- The scheduler and app run in production mode without any compose configuration needed

You cannot override `NODE_ENV` from compose `environment:` when it is set via `ENV` in the
Dockerfile — this is intentional. In development you run `npm run dev` directly, not via Docker.
