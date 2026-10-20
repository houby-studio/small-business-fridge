import { test, expect } from '@playwright/test'
import pg from 'pg'
import { loginAs } from './helpers/auth'

const { Client } = pg

/** Rows of this spec carry these markers, so they are removed again without touching the seed. */
const LEAVING_EMAIL = 'leaving-supplier-e2e@localhost'
const GONE_EMAIL = 'gone-supplier-e2e@localhost'
const PRODUCT_NAME = 'Předávací tyčinka E2E'
const INVOICE_TOTAL = 7791

function dbClient() {
  return new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'sbf',
    password: process.env.DB_PASSWORD ?? 'sbf',
    database: process.env.DB_DATABASE ?? 'sbf_test',
  })
}

async function insertUser(client: pg.Client, email: string, name: string, disabled: boolean) {
  const result = await client.query(
    `INSERT INTO users (email, display_name, password, role, is_kiosk, is_disabled,
       show_all_products, send_mail_on_purchase, send_daily_report, color_mode,
       keypad_disabled, email_verified_at, created_at, updated_at)
     VALUES ($1, $2, NULL, 'supplier', false, $3, false, false, false, 'dark', false,
       NOW(), NOW(), NOW())
     RETURNING id`,
    [email, name, disabled]
  )
  return Number(result.rows[0].id)
}

async function cleanUp(client: pg.Client) {
  const users = await client.query(`SELECT id FROM users WHERE email IN ($1, $2)`, [
    LEAVING_EMAIL,
    GONE_EMAIL,
  ])
  const ids = users.rows.map((row) => Number(row.id))
  await client.query(
    `DELETE FROM deliveries WHERE product_id IN (SELECT id FROM products WHERE display_name = $1)`,
    [PRODUCT_NAME]
  )
  await client.query(`DELETE FROM products WHERE display_name = $1`, [PRODUCT_NAME])
  await client.query(`DELETE FROM invoices WHERE total_cost = $1`, [INVOICE_TOTAL])
  if (ids.length) {
    await client.query(
      `DELETE FROM audit_logs WHERE user_id = ANY($1) OR target_user_id = ANY($1) OR entity_id = ANY($1)`,
      [ids]
    )
    await client.query(`DELETE FROM users WHERE id = ANY($1)`, [ids])
  }
}

test.describe('Admin: a supplier leaves', () => {
  let leavingId = 0
  let goneId = 0

  test.beforeAll(async () => {
    const client = dbClient()
    await client.connect()
    try {
      await cleanUp(client)
      leavingId = await insertUser(client, LEAVING_EMAIL, 'Odcházející Dodavatel', false)
      goneId = await insertUser(client, GONE_EMAIL, 'Bývalý Dodavatel', true)
      const product = await client.query(
        `INSERT INTO products (keypad_id, display_name, description, category_id, created_at, updated_at)
         SELECT COALESCE(MAX(keypad_id), 0) + 1, $1, '', (SELECT MIN(id) FROM categories), NOW(), NOW()
         FROM products RETURNING id`,
        [PRODUCT_NAME]
      )
      await client.query(
        `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price,
           created_at, updated_at)
         VALUES ($1, $2, 6, 6, 15, NOW() - interval '3 days', NOW())`,
        [leavingId, product.rows[0].id]
      )
      await client.query(
        `INSERT INTO invoices (supplier_id, buyer_id, total_cost, is_paid, is_payment_requested,
           auto_reminder_count, manual_reminder_count, created_at, updated_at)
         SELECT $1, c.id, $2, false, true, 0, 0, NOW(), NOW()
         FROM users c WHERE c.email = 'customer@localhost'`,
        [goneId, INVOICE_TOTAL]
      )
    } finally {
      await client.end()
    }
  })

  test.afterAll(async () => {
    const client = dbClient()
    await client.connect()
    try {
      await cleanUp(client)
    } finally {
      await client.end()
    }
  })

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin')
  })

  test('the stock is handed over in a dialog, then the supplier can be disabled', async ({
    page,
  }) => {
    await page.goto(`/admin/users?userId=${leavingId}`)
    const blocked = page.getByTestId(`user-blocked-${leavingId}`)
    await expect(blocked).toHaveAttribute('aria-label', /6 ks/)

    await page.getByTestId(`user-transfer-${leavingId}`).click()
    const dialog = page.getByTestId('transfer-stock-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('6 ks z 1 dodávek')
    await page.getByTestId('transfer-stock-submit').click()

    await expect(dialog).toBeHidden()
    await expect(page.getByText('Zásoby předány')).toBeVisible()
    await expect(page.getByTestId(`user-transfer-${leavingId}`)).toHaveCount(0)
    await expect(page.getByTestId(`user-blocked-${leavingId}`)).toHaveCount(0)
  })

  test('the admin confirms a payment of a supplier who left', async ({ page }) => {
    await page.goto(`/admin/invoices?supplierId=${goneId}`)
    const row = page.locator('.p-datatable tbody tr').filter({ hasText: 'Bývalý Dodavatel' })
    await expect(row).toHaveCount(1)

    await row.getByRole('button', { name: 'Potvrdit platbu' }).click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Potvrdit platbu' }).click()

    await expect(row).toContainText('Zaplaceno')
    await expect(row.getByRole('button', { name: 'Potvrdit platbu' })).toHaveCount(0)
  })
})
