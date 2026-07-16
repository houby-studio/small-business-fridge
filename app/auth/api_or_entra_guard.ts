import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService, ConfigProvider } from '@adonisjs/core/types'
import { AccessTokensGuard } from '@adonisjs/auth/access_tokens'
import type { GuardConfigProvider } from '@adonisjs/auth/types'
import type { AccessTokensUserProviderContract } from '@adonisjs/auth/types/access_tokens'
import { entraIdJwtVerifier } from '#services/entra_id_jwt_verifier'
import { looksLikeJwt } from '#utils/bearer_token'

/**
 * Access-token guard extended to ALSO accept Microsoft Entra ID JWTs.
 *
 * authenticate() first inspects the Bearer token: if it looks like a JWT it is
 * verified via entraIdJwtVerifier (JWKS + oid → local user through
 * UserAuthIdentity). Anything else — and JWTs that don't resolve to a linked
 * user — falls through to the standard opaque personal-token path.
 *
 * Because it extends AccessTokensGuard, opaque tokens, token issuance and the
 * test authenticateAsClient() helper all keep working unchanged, and `auth.user`
 * resolves to the Entra user on the JWT path (the Authenticator reads it straight
 * off the guard instance).
 */
class ApiOrEntraGuard<
  UserProvider extends AccessTokensUserProviderContract<unknown>,
> extends AccessTokensGuard<UserProvider> {
  #httpContext: HttpContext

  constructor(...args: ConstructorParameters<typeof AccessTokensGuard<UserProvider>>) {
    super(...args)
    this.#httpContext = args[1]
  }

  async authenticate() {
    const authHeader = this.#httpContext.request.header('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      if (looksLikeJwt(token)) {
        const user = await entraIdJwtVerifier.resolveUser(token)
        if (user) {
          this.authenticationAttempted = true
          this.isAuthenticated = true
          // Entra-resolved users have no currentAccessToken; API controllers only
          // read `.id` / relations, so the missing token property is harmless.
          this.user = user as unknown as NonNullable<typeof this.user>
          return this.user
        }
        // A JWT that doesn't resolve to a linked user falls through and fails below.
      }
    }
    return super.authenticate()
  }
}

/**
 * Guard config provider mirroring `tokensGuard`, but wiring up {@link ApiOrEntraGuard}
 * so the `api` guard transparently accepts opaque personal tokens AND Entra ID JWTs.
 */
export function apiOrEntraGuard<
  UserProvider extends AccessTokensUserProviderContract<unknown>,
>(config: {
  provider: UserProvider | ConfigProvider<UserProvider>
}): GuardConfigProvider<(ctx: HttpContext) => AccessTokensGuard<UserProvider>> {
  return {
    async resolver(name: string, app: ApplicationService) {
      const emitter = await app.container.make('emitter')
      const provider =
        'resolver' in config.provider ? await config.provider.resolver(app) : config.provider
      return (ctx: HttpContext) => new ApiOrEntraGuard<UserProvider>(name, ctx, emitter, provider)
    },
  }
}
