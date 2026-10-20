import { expect, type Page } from '@playwright/test'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import pg from 'pg'
import { ensureLoginPage, fillLoginForm } from './auth'

const { Client } = pg

/** The parameters `config/hash.ts` uses, so the app verifies the hash it did not make. */
const scrypt = new Scrypt({
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  saltSize: 16,
  keyLength: 64,
  maxMemory: 33554432,
})

export const ISOLATED_PASSWORD = 'isolated123'

export function dbClient() {
  return new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'sbf',
    password: process.env.DB_PASSWORD ?? 'sbf',
    database: process.env.DB_DATABASE ?? 'sbf_test',
  })
}

export interface IsolatedSupplier {
  id: number
  email: string
  name: string
}

/**
 * A supplier of the test's own: no drafts, deliveries, inventories or margin shared with any
 * other test, so counts ("the badge shows 1", "the sheet lists one product") are exact instead
 * of "whatever was there plus one". The e2e database is rebuilt by the global setup, so the
 * user is not removed afterwards.
 */
export async function createIsolatedSupplier(tag: string): Promise<IsolatedSupplier> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const email = `e2e-${tag}-${stamp}@localhost`
  const name = `E2E Dodavatel ${tag} ${stamp}`
  const client = dbClient()
  await client.connect()
  try {
    const result = await client.query(
      `INSERT INTO users (email, display_name, password, role, is_kiosk, is_disabled,
         show_all_products, send_mail_on_purchase, send_daily_report, color_mode,
         keypad_disabled, email_verified_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'supplier', false, false, false, false, false, 'light', false,
         NOW(), NOW(), NOW())
       RETURNING id`,
      [email, name, await scrypt.make(ISOLATED_PASSWORD)]
    )
    return { id: Number(result.rows[0].id), email, name }
  } finally {
    await client.end()
  }
}

export async function loginAsIsolated(page: Page, supplier: IsolatedSupplier) {
  await page.context().clearCookies()
  await ensureLoginPage(page)
  await fillLoginForm(page, supplier.email, ISOLATED_PASSWORD)
  await expect(page).not.toHaveURL(/\/login/)
}

/** Runs one query against the e2e database (for facts the UI does not show). */
export async function queryDb<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = dbClient()
  await client.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    await client.end()
  }
}

/**
 * Logs in as a supplier of the test's own. A supplier has one open stocking draft, so tests
 * that fill or stock a draft must not share one: with the seeded supplier, two tests would
 * write into the same draft and count each other's lines.
 */
export async function loginAsFreshSupplier(page: Page, tag: string): Promise<IsolatedSupplier> {
  const supplier = await createIsolatedSupplier(tag)
  await loginAsIsolated(page, supplier)
  return supplier
}
