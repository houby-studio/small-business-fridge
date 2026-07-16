# MCP (Model Context Protocol) Server

Small Business Fridge exposes an MCP server at `/mcp`, allowing AI assistants like Claude Desktop, Claude Code or GitHub Copilot to interact with the fridge programmatically — browse the shop, buy products, manage invoices and payments, stock products, and administer users.

## Authentication

Three authentication paths are supported:

### 1. Entra ID OAuth (for Microsoft-linked accounts)

The MCP endpoint implements [OAuth 2.0 Protected Resource Metadata (RFC 9728)](https://datatracker.ietf.org/doc/html/rfc9728). AI tools that support MCP OAuth will:

1. Hit `/mcp` without auth and receive a `401` with a `WWW-Authenticate` header.
2. Follow the `resource_metadata` URL to `/.well-known/oauth-protected-resource`.
3. Discover the authorization server and complete a PKCE flow.
4. Present the resulting access token as a Bearer token to the MCP endpoint.

Microsoft Entra ID JWTs are verified against Entra's JWKS endpoint and resolved to a local user via their linked Microsoft account (`user_auth_identities`).

**Requirements:**

- The user must have linked their Microsoft account in the app (Profile → Security → Link Microsoft account).
- `AUTH_PROVIDER_MICROSOFT_CLIENT_ID` and `AUTH_PROVIDER_MICROSOFT_TENANT_ID` must be configured.

### 2. Built-in OAuth server (works with Claude Web via Dynamic Client Registration)

The app also runs its own minimal OAuth 2.1 authorization server:

- `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata
- `POST /oauth/register` — RFC 7591 Dynamic Client Registration (public clients, PKCE only)
- `GET /oauth/authorize` — authorization endpoint (uses the normal web login)
- `POST /oauth/token` — token endpoint (issues opaque tokens via the personal API token mechanism)

**No configuration needed in the MCP client** — just point it at the URL:

```json
{
  "mcpServers": {
    "fridge": {
      "url": "https://your-app.example.com/mcp"
    }
  }
}
```

### 3. Personal API token (for automated scripts)

1. Log in to the web app.
2. Go to **Profile → API Tokens** and create a token (shown only once).

```json
{
  "mcpServers": {
    "fridge": {
      "url": "https://your-app.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <your-personal-api-token>"
      }
    }
  }
}
```

> Kiosk accounts and disabled accounts are rejected at `/mcp` with `403`.

## Transport

Uses the **MCP Streamable HTTP** transport (stateless mode). Each request is authenticated independently — no persistent session is maintained. The SDK answers with SSE or plain JSON based on the client's `Accept` header.

## Workflow Prompt

The server exposes a built-in prompt that gives AI agents a complete, role-aware workflow reference — exact tool sequences, parameter names, error codes, and constraints.

```
prompts/list  → ["workflow"]
prompts/get   → { name: "workflow" }
```

**Load it at the start of every session.** It covers the shop → buy → invoice → QR payment flow, the supplier stocking/invoicing lifecycle, admin operations and all error codes.

## Available Tools

Tools are granted based on the account role. Admins implicitly get supplier tools.

### All Users (customer, supplier, admin)

| Tool                     | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `list_products`          | Browse the shop with stock and prices (respects allergen preferences)   |
| `list_categories`        | List product categories                                                 |
| `buy_product`            | 1-click purchase by deliveryId or productId (quantity 1–10)             |
| `get_my_orders`          | Your purchase history with invoiced status                              |
| `get_my_invoices`        | Your invoices with status (unpaid / awaiting / paid)                    |
| `get_payment_qr`         | Czech SPD QR payment string + bank details for an invoice               |
| `request_payment`        | Report an invoice as paid (supplier then confirms)                      |
| `cancel_payment_request` | Withdraw a reported payment                                             |
| `get_recommendations`    | Personalized product recommendations                                    |

### Supplier (and admin)

| Tool                    | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `add_stock`             | Create a delivery lot (product, amount, unit price)               |
| `get_stock`             | Stock overview with low-stock alerts and top movers               |
| `recent_deliveries`     | Your recent delivery lots                                         |
| `list_catalog_products` | Full catalog incl. out-of-stock, with search                      |
| `create_product`        | Create a product (idempotent by name, image added later in web)   |
| `update_product`        | Update product metadata                                           |
| `uninvoiced_summary`    | Who owes how much, grouped by buyer                               |
| `generate_invoices`     | Batch-generate invoices (all buyers or one)                       |
| `list_issued_invoices`  | Invoices you issued, filterable by status                         |
| `approve_payment`       | Confirm a received payment                                        |
| `reject_payment`        | Reject a reported payment                                         |

### Admin Only

| Tool                         | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| `dashboard_stats`            | Global overview stats                                    |
| `list_users`                 | Browse users with role/status filters                    |
| `update_user`                | Change role, enable/disable, keypad ID                   |
| `list_all_orders`            | All orders with filters                                  |
| `list_all_invoices`          | All invoices with filters                                |
| `storno_order`               | Cancel an uninvoiced order (restores stock)              |
| `generate_invoices_for_user` | Invoice all debts of one buyer across suppliers          |
| `create_category`            | Create a product category                                |
| `get_audit_logs`             | Query the system audit log                               |

## Usage Examples

### Customer: buy a drink

```
User: Kup mi kofolu
Claude: [calls list_products] → finds Kofola with deliveryId=3, price 25 CZK
        [calls buy_product with deliveryId=3]
        → "Koupeno! Kofola za 25 Kč. Zaplatíš později přes fakturu."
```

### Customer: pay an invoice

```
User: Kolik dlužím a jak to zaplatím?
Claude: [calls get_my_invoices with status="unpaid"]
        [calls get_payment_qr with invoiceId=12]
        → "Dlužíš 260 Kč dodavateli Jakub. IBAN CZ65..., SPD kód pro QR platbu: ..."
        [after user pays] → [calls request_payment with invoiceId=12]
```

### Supplier: monthly billing run

```
User: Vyfakturuj všechny nezaplacené nákupy
Claude: [calls uninvoiced_summary] → 4 buyers owe 1 240 CZK total
        [calls generate_invoices]
        → "Vygenerovány 4 faktury. Kupující dostali e-mail s QR platbou."
```

### Admin: check who changed a user account

```
User: Kdo naposledy měnil účet Jakuba?
Claude: [calls list_users to find the user ID]
        [calls get_audit_logs with userId=..., action="user.updated"]
        → "Admin Pavel změnil roli na supplier 2026-07-01 ve 14:23."
```

## Tool-call Logging

Every tool call is recorded in the `mcp_tool_calls` table (user, tool, arguments, success, duration) for auditing and debugging.

## Error Handling

All tools return structured responses. When an operation fails, the tool returns `isError: true` with a descriptive message including a machine-readable code:

- **OUT_OF_STOCK** — the product/delivery has no stock left
- **FORBIDDEN** — the record does not belong to you
- **ALREADY_PAID** — the invoice is already paid
- **ORDER_ALREADY_INVOICED** — storno is not possible after invoicing
- **LAST_ACTIVE_ADMIN_REQUIRED / USER_HAS_UNINVOICED_ORDERS / KEYPAD_ID_TAKEN** — user-management constraints
