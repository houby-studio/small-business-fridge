import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import pg from 'pg'

const { Client } = pg

type TestDbConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export type ActiveDbConnection = {
  pid: number
  applicationName: string | null
  clientAddress: string | null
  state: string | null
}

let envLoaded = false

export function loadTestEnvFile() {
  if (envLoaded) return

  const envPath = resolve(process.cwd(), '.env.test')
  if (existsSync(envPath)) {
    loadDotEnv({ path: envPath, override: false })
  }

  envLoaded = true
}

export function getTestDbConfigFromEnv(): TestDbConfig {
  loadTestEnvFile()

  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'sbf',
    password: process.env.DB_PASSWORD ?? 'sbf',
    database: process.env.DB_DATABASE ?? 'sbf_test',
  }
}

export function getTestRuntimeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  loadTestEnvFile()

  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

  return {
    ...inheritedEnv,
    TZ: process.env.TZ ?? 'UTC',
    NODE_ENV: 'test',
    HOST: process.env.HOST ?? 'localhost',
    PORT: process.env.PORT ?? '3334',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
    APP_KEY: process.env.APP_KEY ?? 'test-app-key-for-testing-only-123',
    SESSION_DRIVER: process.env.SESSION_DRIVER ?? 'memory',
    DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.DB_PORT ?? '5432',
    DB_USER: process.env.DB_USER ?? 'sbf',
    DB_PASSWORD: process.env.DB_PASSWORD ?? 'sbf',
    DB_DATABASE: process.env.DB_DATABASE ?? 'sbf_test',
    SMTP_HOST: process.env.SMTP_HOST ?? '127.0.0.1',
    SMTP_PORT: process.env.SMTP_PORT ?? '1025',
    SMTP_USERNAME: process.env.SMTP_USERNAME ?? '',
    SMTP_PASSWORD: process.env.SMTP_PASSWORD ?? '',
    SMTP_FROM_ADDRESS: process.env.SMTP_FROM_ADDRESS ?? 'noreply@test.local',
    SMTP_FROM_NAME: process.env.SMTP_FROM_NAME ?? 'Test',
    // Keep auth mode deterministic for tests, regardless of developer shell env.
    AUTH_PROVIDERS: 'local',
    AUTH_AUTO_REGISTER_PROVIDERS: '',
    AUTH_REGISTRATION_MODE: '',
    AUTH_REGISTRATION_ALLOWED_DOMAINS: '',
    AUTH_PROVIDER_MICROSOFT_CLIENT_ID: '',
    AUTH_PROVIDER_MICROSOFT_CLIENT_SECRET: '',
    AUTH_PROVIDER_MICROSOFT_TENANT_ID: 'common',
    AUTH_PROVIDER_MICROSOFT_REDIRECT_URI: '',
    AUTH_PROVIDER_DISCORD_CLIENT_ID: '',
    AUTH_PROVIDER_DISCORD_CLIENT_SECRET: '',
    AUTH_PROVIDER_DISCORD_REDIRECT_URI: '',
    AUTH_PROVIDER_DISCORD_SCOPES: 'identify,email',
    API_SECRET: process.env.API_SECRET ?? 'test-api-secret',
    APP_URL: process.env.APP_URL ?? 'http://localhost:3334',
    ...overrides,
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export async function ensureTestDatabaseExists() {
  const config = getTestDbConfigFromEnv()

  const adminClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'postgres',
  })

  await adminClient.connect()

  try {
    const result = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      config.database,
    ])

    if (result.rowCount && result.rowCount > 0) return

    try {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`)
    } catch (error: any) {
      // Ignore duplicate-database races when test setup is triggered concurrently.
      if (error?.code !== '42P04') {
        throw error
      }
    }
  } finally {
    await adminClient.end()
  }
}

export async function listOtherDatabaseConnections(
  databaseName = getTestDbConfigFromEnv().database
): Promise<ActiveDbConnection[]> {
  const config = getTestDbConfigFromEnv()
  const adminClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'postgres',
  })

  await adminClient.connect()

  try {
    const result = await adminClient.query<{
      pid: number
      application_name: string | null
      client_addr: string | null
      state: string | null
    }>(
      `SELECT pid, application_name, client_addr::text, state
       FROM pg_stat_activity
       WHERE datname = $1
         AND backend_type = 'client backend'
         AND pid <> pg_backend_pid()
       ORDER BY pid ASC`,
      [databaseName]
    )

    return result.rows.map((row) => ({
      pid: row.pid,
      applicationName: row.application_name,
      clientAddress: row.client_addr,
      state: row.state,
    }))
  } finally {
    await adminClient.end()
  }
}
