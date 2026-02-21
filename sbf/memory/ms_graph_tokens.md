# MS Graph Token Strategy

## Current State (as of v3/auth branch)

The OIDC flow (`oidc_controller.ts`) obtains a Microsoft access token via:

```typescript
const msUser = await microsoft.user() // calls MS Graph /me
```

The access token is available at `msUser.token.token` (access) and `msUser.token.refreshToken`
but is **discarded** after the callback. Only user identity data (OID, email, displayName, phone)
is persisted to the DB.

Configured scopes: `['openid', 'profile', 'email', 'User.Read']`

## Discussed Strategy: Session-only Storage

**Preferred approach for when MS Graph calls are needed:**

- Store the access token in the **AdonisJS session** (encrypted cookie or server-side store)
- Key: e.g. `ms_access_token` + `ms_token_expires_at`
- If the token is needed and has expired, trigger a **client-side silent re-auth** via OIDC
  (`prompt=none` parameter in the redirect) — no visible re-auth if the user has a valid
  Microsoft session
- This avoids persistent storage of tokens in the DB entirely

**Pros:**

- No DB schema changes
- Token is never at rest in a DB
- Simple — token lives as long as the session

**Cons:**

- Offline/background use impossible — server-side Graph calls fail after token expires
- Requires the user to be actively using the app for token refresh

## What Would Be Needed for Full Offline Support

1. **New DB table** `user_ms_tokens`:

   ```
   user_id (FK → users, CASCADE), access_token (encrypted text),
   refresh_token (encrypted text), expires_at timestamp
   ```

2. **Token storage on OIDC callback**: save access + refresh tokens after successful login

3. **`MicrosoftGraphService`**: wraps `@microsoft/microsoft-graph-client`, handles:
   - Token expiry check before each call
   - Refresh via `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
     with `grant_type=refresh_token`
   - Token rotation on refresh

4. **Scopes**: would need `offline_access` added to ally config to get a refresh token
   (currently not in scope list)

## Decision

Currently **not implemented** — no known use case yet. Re-evaluate when a specific Graph API
feature is needed. Start with the session-only approach and add offline support only if needed.
