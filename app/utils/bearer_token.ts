/**
 * Heuristic used to distinguish the two kinds of Bearer token this app accepts:
 *
 * - Entra ID access tokens are JWTs: three base64url segments separated by dots
 *   (header.payload.signature).
 * - Personal API tokens issued by this app are opaque strings (`oat_...`) with no
 *   dot-delimited structure.
 *
 * Shared by the MCP controller and the api_or_entra auth guard so both agree on
 * how a token is classified.
 */
export function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3
}
