import { createRemoteJWKSet, jwtVerify } from 'jose'
import env from '#start/env'
import UserAuthIdentity from '#models/user_auth_identity'
import type User from '#models/user'

export type EntraIdClaims = {
  oid: string
  tid?: string
  preferred_username?: string
  name?: string
  email?: string
}

/**
 * Verifies a JWT issued by Microsoft Entra ID and resolves it to a local User.
 *
 * The JWKS is fetched from the Entra ID discovery endpoint and cached
 * automatically by jose (refreshed on key rotation).
 *
 * Returns null when:
 *  - The token is not a valid Entra ID JWT (wrong signature, expired, wrong audience)
 *  - The oid claim does not match any UserAuthIdentity linked to a local user
 */
export class EntraIdJwtVerifier {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null

  private get tenantId(): string {
    return env.get('AUTH_PROVIDER_MICROSOFT_TENANT_ID') || 'common'
  }

  private get clientId(): string {
    return env.get('AUTH_PROVIDER_MICROSOFT_CLIENT_ID') || ''
  }

  /**
   * Both issuer forms Entra can stamp on a token for this tenant:
   *  - v2.0 endpoint: https://login.microsoftonline.com/<tenant>/v2.0
   *  - v1.0 endpoint: https://sts.windows.net/<tenant>/  (ver: "1.0" tokens)
   *
   * Custom-API access tokens are v1.0 unless the app registration sets
   * requestedAccessTokenVersion=2, so we must accept both.
   */
  private get issuers(): string[] {
    return [
      `https://login.microsoftonline.com/${this.tenantId}/v2.0`,
      `https://sts.windows.net/${this.tenantId}/`,
    ]
  }

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`)
      )
    }
    return this.jwks
  }

  /**
   * Verifies the JWT and returns the decoded claims on success, or null on failure.
   * Does NOT throw — all errors are swallowed and result in null.
   */
  async verifyClaims(token: string): Promise<EntraIdClaims | null> {
    const clientId = this.clientId
    if (!clientId) return null

    try {
      const { payload } = await jwtVerify(token, this.getJwks(), {
        issuer: this.issuers,
        // Entra ID access tokens may have clientId or api://clientId as audience
        audience: [clientId, `api://${clientId}`],
        algorithms: ['RS256'],
      })

      if (typeof payload['oid'] !== 'string') return null

      return {
        oid: payload['oid'] as string,
        tid: payload['tid'] as string | undefined,
        preferred_username: payload['preferred_username'] as string | undefined,
        name: payload['name'] as string | undefined,
        email: payload['email'] as string | undefined,
      }
    } catch {
      return null
    }
  }

  /**
   * Verifies the token and resolves the oid to a local User via UserAuthIdentity.
   * Returns null if the token is invalid or no linked account is found.
   */
  async resolveUser(token: string): Promise<User | null> {
    const claims = await this.verifyClaims(token)
    if (!claims) return null

    const identity = await UserAuthIdentity.query()
      .where('provider', 'microsoft')
      .where('providerUserId', claims.oid)
      .preload('user')
      .first()

    return identity?.user ?? null
  }
}

// Singleton — reuse the JWKS cache across requests
export const entraIdJwtVerifier = new EntraIdJwtVerifier()
