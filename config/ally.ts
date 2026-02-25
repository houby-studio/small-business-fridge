import { defineConfig } from '@adonisjs/ally'
import type { InferSocialProviders } from '@adonisjs/ally/types'
import { microsoft } from '@tpointurier/ally-microsoft'
import env from '#start/env'

const allyConfig = defineConfig({
  microsoft: microsoft({
    clientId: env.get('OIDC_CLIENT_ID', ''),
    clientSecret: env.get('OIDC_CLIENT_SECRET', ''),
    callbackUrl: env.get('OIDC_REDIRECT_URI', 'http://localhost:3333/auth/oidc/callback'),
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    tenantId: env.get('OIDC_TENANT_ID', 'common'),
  }),
})

export default allyConfig

declare module '@adonisjs/ally/types' {
  interface SocialProviders extends InferSocialProviders<typeof allyConfig> {}
}
