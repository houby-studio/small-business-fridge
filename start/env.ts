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

  /*
  |----------------------------------------------------------
  | Scheduler cron expressions (all default to Mon-Fri)
  |----------------------------------------------------------
  */
  CRON_DAILY_REPORT: Env.schema.string.optional(),
  CRON_UNPAID_REMINDER: Env.schema.string.optional(),
  CRON_PENDING_APPROVAL: Env.schema.string.optional(),
  UNPAID_REMINDER_MIN_AGE_DAYS: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | OpenAI integration
  |----------------------------------------------------------
  */
  OPENAI_API_KEY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | ESL integration
  |----------------------------------------------------------
  */
  ESL_AIMS_ENABLED: Env.schema.boolean.optional(),
  ESL_AIMS_BASE_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  ESL_AIMS_STORE: Env.schema.string.optional(),
  ESL_AIMS_CRON: Env.schema.string.optional(),
  ESL_AIMS_VERIFY_TLS: Env.schema.boolean.optional(),

  ESL_JAMES_ENABLED: Env.schema.boolean.optional(),
  ESL_JAMES_BASE_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  ESL_JAMES_STORE: Env.schema.string.optional(),
  ESL_JAMES_API_KEY: Env.schema.string.optional(),
  ESL_JAMES_CRON: Env.schema.string.optional(),
  ESL_JAMES_VERIFY_TLS: Env.schema.boolean.optional(),
})
