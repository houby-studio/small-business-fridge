<p align="center">
  <img src="https://raw.githubusercontent.com/houby-studio/fridgora/master/public/icon-192.png" alt="Fridgora" width="96" height="96" />
</p>

<h1 align="center">Fridgora</h1>

<p align="center">
  <strong>The office fridge, run like a tiny shop — at cost, with no cash box and no spreadsheet.</strong><br />
  Colleagues grab a drink, tap <em>Buy</em> and settle up later with a QR bank transfer.
</p>

<p align="center">
  <a href="https://github.com/houby-studio/fridgora">GitHub</a> ·
  <a href="https://github.com/houby-studio/fridgora/blob/master/docs/deployment.md">Deployment guide</a> ·
  <a href="https://github.com/houby-studio/fridgora/releases">Releases &amp; changelog</a> ·
  <a href="https://github.com/houby-studio/fridgora/issues">Issues</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/houby-studio/fridgora/master/docs/screenshots/shop.webp" alt="The Fridgora shop" width="860" />
</p>

## What it is

A self-hosted web app for sharing snacks and drinks with colleagues **at cost**. A supplier stocks
the fridge, colleagues buy in one click — on the web, a phone, a touchscreen kiosk, the REST API or
an AI assistant over MCP — and pay later from an invoice with a QR bank-transfer code.

Single sign-on (Microsoft Entra ID, Discord), a full audit log, Czech and English, light and dark
mode. MIT licensed. Full feature list on [GitHub](https://github.com/houby-studio/fridgora#-features).

## Quick start

The image needs PostgreSQL. The ready-made `compose.yaml` wires up the app, the scheduler
(reminders, reports) and the database:

```bash
wget https://raw.githubusercontent.com/houby-studio/fridgora/refs/heads/master/compose.yaml
wget https://raw.githubusercontent.com/houby-studio/fridgora/refs/heads/master/.env.example -O .env
# fill in APP_KEY, APP_URL and DB_PASSWORD in .env
docker compose up -d
```

Open `http://localhost:3000`; the first visit creates the admin account. Generate `APP_KEY` with:

```bash
docker run --rm houbystudio/fridgora node ace generate:key --show
```

## Tags

| Tag      | What it is                                                     |
| -------- | -------------------------------------------------------------- |
| `X.Y.Z`  | A release. **Pin this in production**, so rollbacks are exact. |
| `latest` | The newest release — never a branch build.                     |
| `master` | The tip of `master`, for testing what comes next.              |
| `<sha>`  | One exact commit, immutable.                                   |

Images are multi-arch: **`linux/amd64`** and **`linux/arm64`** (Raspberry Pi 4/5, ARM servers,
Apple Silicon).

## Configuration

| What               | Where                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port               | `3000` inside the container                                                                                                                                 |
| Uploaded images    | `/app/storage/uploads` — mount a volume                                                                                                                     |
| Required variables | `APP_KEY`, `APP_URL`, `DB_HOST`, `DB_PASSWORD` (plus `DB_USER`, `DB_DATABASE`)                                                                              |
| Everything else    | [`.env.example`](https://github.com/houby-studio/fridgora/blob/master/.env.example) documents every option                                                  |
| Secrets            | Passwords and keys can come from [Docker secrets](https://github.com/houby-studio/fridgora/blob/master/docs/deployment.md#secure-deployment-docker-secrets) |

## Verify before you run it

Every image is built only from a commit that passed the full test suite, and carries a **signed
SLSA build provenance** attestation. Check that an image really comes from this repository's CI:

```bash
gh attestation verify oci://docker.io/houbystudio/fridgora:<version> \
  --repo houby-studio/fridgora \
  --signer-workflow houby-studio/fridgora/.github/workflows/docker-image.yml \
  --source-ref refs/tags/<version>
```

## Moving from `houbystudio/sbf`

Fridgora was called _Small Business Fridge_ until 3.2.1, published as
[`houbystudio/sbf`](https://hub.docker.com/r/houbystudio/sbf). Change the image name in your
`compose.yaml` — data, volumes and configuration stay as they are.

---

<sub>This page is generated from <a href="https://github.com/houby-studio/fridgora/blob/master/docker/README.md">docker/README.md</a> on every release.</sub>
