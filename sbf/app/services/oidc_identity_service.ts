import User from '#models/user'

export type OidcIdentityMatch =
  | { kind: 'matched'; user: User; via: 'oid' | 'email_linked' }
  | { kind: 'not_found' }
  | { kind: 'ambiguous_email'; email: string; userIds: number[] }
  | { kind: 'oid_conflict'; email: string; userId: number }
  | { kind: 'missing_oid'; email: string }

/**
 * Resolve an application user for OIDC identity in a safe way.
 *
 * Safety rules:
 * - Prefer direct OID match.
 * - Email fallback is allowed only when exactly one user matches.
 * - If fallback user already has a different OID, reject (possible account mix-up).
 * - If OIDC provider did not return OID, reject email-only login.
 */
export default class OidcIdentityService {
  async resolve(params: { oid: string | null; email: string | null }): Promise<OidcIdentityMatch> {
    const oid = params.oid?.trim() || null
    const email = params.email?.trim().toLowerCase() || null

    if (oid) {
      const userByOid = await User.query().where('oid', oid).first()
      if (userByOid) {
        return { kind: 'matched', user: userByOid, via: 'oid' }
      }
    }

    if (!email) {
      return { kind: 'not_found' }
    }

    const usersByEmail = await User.query()
      .whereRaw('LOWER(email) = ?', [email])
      .orderBy('id', 'asc')

    if (usersByEmail.length === 0) {
      return { kind: 'not_found' }
    }

    if (usersByEmail.length > 1) {
      return {
        kind: 'ambiguous_email',
        email,
        userIds: usersByEmail.map((user) => user.id),
      }
    }

    const matched = usersByEmail[0]

    if (!oid) {
      return { kind: 'missing_oid', email }
    }

    if (matched.oid && matched.oid !== oid) {
      return { kind: 'oid_conflict', email, userId: matched.id }
    }

    return { kind: 'matched', user: matched, via: 'email_linked' }
  }
}
