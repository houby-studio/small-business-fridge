import { defineConfig } from '@adonisjs/auth'
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'
import { tokensUserProvider } from '@adonisjs/auth/access_tokens'
import { apiOrEntraGuard } from '#auth/api_or_entra_guard'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

const authConfig = defineConfig({
  default: 'web',
  guards: {
    web: sessionGuard({
      useRememberMeTokens: true,
      rememberMeTokensAge: '2 years',
      provider: sessionUserProvider({
        model: () => import('#models/user'),
      }),
    }),
    // Accepts opaque personal API tokens AND Microsoft Entra ID JWTs.
    api: apiOrEntraGuard({
      provider: tokensUserProvider({
        tokens: 'accessTokens',
        model: () => import('#models/user'),
      }),
    }),
  },
})

export default authConfig

/**
 * Inferring types from the configured auth guards.
 */
declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  interface EventsList extends InferAuthEvents<Authenticators> {}
}
