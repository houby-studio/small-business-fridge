/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const),
  APP_NAME: Env.schema.string.optional(),
  CURRENCY: Env.schema.string.optional(),

  /**
   * Pins the Inertia asset version instead of hashing the Vite manifest. Leave unset in
   * production so a deploy still forces clients onto the new bundle; set it (e.g. to a
   * commit sha, or any constant in CI) when the manifest is not a reliable source.
   */
  ASSETS_VERSION: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),
  DB_POOL_MIN: Env.schema.number.optional(),
  DB_POOL_MAX: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the mail package
  |----------------------------------------------------------
  */
  SMTP_HOST: Env.schema.string({ format: 'host' }),
  SMTP_PORT: Env.schema.number(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
  SMTP_FROM_ADDRESS: Env.schema.string.optional({ format: 'email' }),
  SMTP_FROM_NAME: Env.schema.string.optional(),
  SMTP_IGNORE_TLS: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring external authentication providers
  |----------------------------------------------------------
  */
  AUTH_PROVIDERS: Env.schema.string.optional(),
  AUTH_AUTO_REGISTER_PROVIDERS: Env.schema.string.optional(),
  AUTH_PROVIDER_MICROSOFT_CLIENT_ID: Env.schema.string.optional(),
  AUTH_PROVIDER_MICROSOFT_CLIENT_SECRET: Env.schema.string.optional(),
  AUTH_PROVIDER_MICROSOFT_TENANT_ID: Env.schema.string.optional(),
  AUTH_PROVIDER_MICROSOFT_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),
  AUTH_PROVIDER_MICROSOFT_EMAIL_VERIFICATION_MODE: Env.schema.enum.optional([
    'always',
    'claim',
    'never',
  ] as const),
  AUTH_PROVIDER_DISCORD_CLIENT_ID: Env.schema.string.optional(),
  AUTH_PROVIDER_DISCORD_CLIENT_SECRET: Env.schema.string.optional(),
  AUTH_PROVIDER_DISCORD_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),
  AUTH_PROVIDER_DISCORD_SCOPES: Env.schema.string.optional(),
  AUTH_PROVIDER_DISCORD_EMAIL_VERIFICATION_MODE: Env.schema.enum.optional([
    'always',
    'claim',
    'never',
  ] as const),
  AUTH_REGISTRATION_MODE: Env.schema.enum.optional([
    'open',
    'invite_only',
    'domain_auto_approve',
    'closed',
  ] as const),
  AUTH_REGISTRATION_ALLOWED_DOMAINS: Env.schema.string.optional(),
  AUTH_EMAIL_VERIFICATION_REQUIRED: Env.schema.boolean.optional(),
  EMAIL_VERIFICATION_TTL_MINUTES: Env.schema.number.optional(),
  IBAN_CHANGE_TTL_MINUTES: Env.schema.number.optional(),
  SENSITIVE_ACTION_REAUTH_TTL_MINUTES: Env.schema.number.optional(),
  INVITE_EXPIRY_HOURS: Env.schema.number.optional(),
  PASSWORD_RESET_TTL_MINUTES: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Variables for API authentication
  |----------------------------------------------------------
  */
  API_SECRET: Env.schema.string.optional(),
  KIOSK_LOGOUT_CODE: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Application settings
  |----------------------------------------------------------
  */
  APP_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  FEEDBACK_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  SWAGGER_ENABLED: Env.schema.boolean.optional(),
  RATINGS_PUBLIC_FEED_ENABLED: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | Product image pipeline (docs/product-images.md)
  |----------------------------------------------------------
  */
  PRODUCT_IMAGE_WIDTH: Env.schema.number.optional(),
  PRODUCT_IMAGE_HEIGHT: Env.schema.number.optional(),
  PRODUCT_IMAGE_ROTATE_MIN_RATIO: Env.schema.number.optional(),
  PRODUCT_IMAGE_ROTATE_DIRECTION: Env.schema.enum.optional(['cw', 'ccw'] as const),
  PRODUCT_IMAGE_BG_AUTO: Env.schema.string.optional(),
  PRODUCT_IMAGE_REMBG_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  PRODUCT_IMAGE_REMBG_MODEL: Env.schema.string.optional(),
  PRODUCT_IMAGE_REMBG_TIMEOUT_MS: Env.schema.number.optional(),
  PRODUCT_IMAGE_CLOUDFLARE_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  PRODUCT_IMAGE_CLOUDFLARE_TOKEN: Env.schema.string.optional(),
  PRODUCT_IMAGE_CLOUDFLARE_TIMEOUT_MS: Env.schema.number.optional(),
  PRODUCT_IMAGE_OPENFOODFACTS_ENABLED: Env.schema.boolean.optional(),
  PRODUCT_IMAGE_OPENFOODFACTS_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  PRODUCT_IMAGE_OPENFOODFACTS_USER: Env.schema.string.optional(),
  PRODUCT_IMAGE_OPENFOODFACTS_PASSWORD: Env.schema.string.optional(),
  PRODUCT_AI_ENDPOINT: Env.schema.string.optional({ format: 'url', tld: false }),
  PRODUCT_AI_DEPLOYMENT: Env.schema.string.optional(),
  PRODUCT_AI_API_VERSION: Env.schema.string.optional(),
  PRODUCT_AI_API_KEY: Env.schema.string.optional(),
  PRODUCT_AI_TENANT_ID: Env.schema.string.optional(),
  PRODUCT_AI_CLIENT_ID: Env.schema.string.optional(),
  PRODUCT_AI_CLIENT_SECRET: Env.schema.string.optional(),
  PRODUCT_AI_BEARER_TOKEN: Env.schema.string.optional(),
  PRODUCT_AI_AUTHORITY_URL: Env.schema.string.optional({ format: 'url', tld: false }),

  /*
  |----------------------------------------------------------
  | Scheduler cron expressions (all default to Mon-Fri)
  |----------------------------------------------------------
  */
  CRON_DAILY_REPORT: Env.schema.string.optional(),
  CRON_UNPAID_REMINDER: Env.schema.string.optional(),
  CRON_PENDING_APPROVAL: Env.schema.string.optional(),
  CRON_ANONYMIZE_DISABLED: Env.schema.string.optional(),
  UNPAID_REMINDER_MIN_AGE_DAYS: Env.schema.number.optional(),
  ANONYMIZE_DISABLED_USERS: Env.schema.boolean.optional(),
  ANONYMIZE_GRACE_DAYS: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Build metadata
  |----------------------------------------------------------
  | Baked into the image at build time by the release workflow; never set by hand.
  | Absent in local development, where the app reports itself as `dev`.
  */
  APP_VERSION: Env.schema.string.optional(),
  GIT_SHA: Env.schema.string.optional(),
  BUILD_DATE: Env.schema.string.optional(),
})
