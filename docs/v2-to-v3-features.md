# v2 → v3 Feature Parity

> Status of the old Express/MongoDB stack's features in the AdonisJS/PostgreSQL rewrite.
> Last reviewed: 2026-09-23 (against v3.0.0).

## Closed gaps

These were listed as missing in earlier revisions of this document and are now implemented:

| Feature                | Where it lives now                                                              |
| ---------------------- | ------------------------------------------------------------------------------- |
| Restock notifications  | `DeliveriesController.store()` → `NotificationService.sendRestockNotification()` |
| Customer insights API  | `GET /api/v1/customers/:id/insights` (`CustomersController.insights()`)          |
| Product list API       | `GET /api/v1/products`, `GET /api/v1/products/:barcode`                          |
| API documentation page | `GET /docs` (Scalar UI over the generated OpenAPI spec)                          |
| Database backups       | Handled by the host, not the app: nightly `pg_dump` + upload archive, GFS        |

## Open gaps

| Gap                     | Priority | Detail                                                                                                                     |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Scanner device firmware | Medium   | Old `/api/scanner*` endpoints are gone. Equivalents exist under `/api/v1`, but embedded firmware must be repointed.         |
| System alert emails     | Medium   | No mechanism to email an admin when a critical error occurs. Logs are the only signal.                                      |
| Daily phone sync task   | Low      | `daily-user-phones.js` existed in v2 with an unclear purpose (possibly webhook sync). Not reimplemented; no known need.     |
| Theme selection         | Low      | v2 had a `theme` enum (happy/angry/shocked) on the user. v3 only has `colorMode` (light/dark).                              |

## Deliberately not carried over

| Feature              | Decision                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| ESL integration      | AIMS/JAMES shelf labels. Config stubs were removed in 3.1.0 — no hardware in use. To be built fresh when needed. |
| GPT product slogans  | v2 had `POST /api/promptGpt` for AI-generated product descriptions. Not planned.                                |

## Added in v3 (no v2 equivalent)

TypeScript throughout, 575 unit/functional tests plus 79 Playwright e2e tests, `RecommendationService`
with nightly statistical suggestions, personal API tokens, structured `AuditLog`, `PageView` tracking,
impersonation, a proper kiosk session model, allergen tracking, product ratings, invite-based local
accounts, and an [MCP server](mcp.md) exposing the fridge to AI assistants.
