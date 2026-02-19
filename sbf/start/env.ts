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
  LOG_LEVEL: Env.schema.string(),

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
  SMTP_FROM_ADDRESS: Env.schema.string.optional(),
  SMTP_FROM_NAME: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring OIDC (Microsoft Entra ID)
  |----------------------------------------------------------
  */
  OIDC_ENABLED: Env.schema.boolean.optional(),
  OIDC_AUTO_REGISTER: Env.schema.boolean.optional(),
  OIDC_CLIENT_ID: Env.schema.string.optional(),
  OIDC_CLIENT_SECRET: Env.schema.string.optional(),
  OIDC_TENANT_ID: Env.schema.string.optional(),
  OIDC_REDIRECT_URI: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for API authentication
  |----------------------------------------------------------
  */
  API_SECRET: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Application settings
  |----------------------------------------------------------
  */
  APP_URL: Env.schema.string.optional(),
  FEEDBACK_URL: Env.schema.string.optional(),

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
  ESL_AIMS_BASE_URL: Env.schema.string.optional(),
  ESL_AIMS_STORE: Env.schema.string.optional(),
  ESL_AIMS_CRON: Env.schema.string.optional(),
  ESL_AIMS_VERIFY_TLS: Env.schema.boolean.optional(),

  ESL_JAMES_ENABLED: Env.schema.boolean.optional(),
  ESL_JAMES_BASE_URL: Env.schema.string.optional(),
  ESL_JAMES_STORE: Env.schema.string.optional(),
  ESL_JAMES_API_KEY: Env.schema.string.optional(),
  ESL_JAMES_CRON: Env.schema.string.optional(),
  ESL_JAMES_VERIFY_TLS: Env.schema.boolean.optional(),
})
