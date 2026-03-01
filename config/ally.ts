import { defineConfig } from '@adonisjs/ally'
import type { InferSocialProviders } from '@adonisjs/ally/types'
import { microsoft } from '#services/ally_microsoft_driver'
import { discord } from '#services/ally_discord_driver'
import env from '#start/env'

const allyConfig = defineConfig({
  microsoft: microsoft({
    clientId: env.get('AUTH_PROVIDER_MICROSOFT_CLIENT_ID', ''),
    clientSecret: env.get('AUTH_PROVIDER_MICROSOFT_CLIENT_SECRET', ''),
    callbackUrl: env.get(
      'AUTH_PROVIDER_MICROSOFT_REDIRECT_URI',
      'http://localhost:3333/auth/microsoft/callback'
    ),
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    tenantId: env.get('AUTH_PROVIDER_MICROSOFT_TENANT_ID', 'common'),
  }),
  discord: discord({
    clientId: env.get('AUTH_PROVIDER_DISCORD_CLIENT_ID', ''),
    clientSecret: env.get('AUTH_PROVIDER_DISCORD_CLIENT_SECRET', ''),
    callbackUrl: env.get(
      'AUTH_PROVIDER_DISCORD_REDIRECT_URI',
      'http://localhost:3333/auth/discord/callback'
    ),
    scopes: env
      .get('AUTH_PROVIDER_DISCORD_SCOPES', 'identify,email')
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0),
  }),
})

export default allyConfig

declare module '@adonisjs/ally/types' {
  interface SocialProviders extends InferSocialProviders<typeof allyConfig> {}
}
