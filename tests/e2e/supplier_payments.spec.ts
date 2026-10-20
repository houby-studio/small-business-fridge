import { test, expect, type Page } from '@playwright/test'
import pg from 'pg'
import { loginAs } from './helpers/auth'

const { Client } = pg

/**
 * Totals nothing in the seed uses, so the rows this spec creates can be told apart from the
 * seeded invoices and removed again afterwards without touching them.
 */
const ORDERING_TOTAL = 7777
const REJECT_TOTAL = 7778

const STATUS_RANK: Record<string, number> = {
  'Čeká na schválení': 0,
  'Nezaplaceno': 1,
  'Zaplaceno': 2,
}

function dbClient() {
  return new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'sbf',
    password: process.env.DB_PASSWORD ?? 'sbf',
    database: process.env.DB_DATABASE ?? 'sbf_test',
  })
}

async function readRows(page: Page) {
  const rows = page.locator('.p-datatable tbody tr')
  const count = await rows.count()
  const result: { total: string; status: string }[] = []
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td')
    // Money is locale-formatted ("7 777 Kč" with a no-break space), so compare digits only.
    const totalText = await cells.nth(3).innerText()
    const total = totalText.replace(/\s/g, '')
    const status = await cells.nth(4).getByTestId('payment-status').innerText()
    result.push({ total, status: status.trim() })
  }
  return result
}

test.describe('Supplier payments list', () => {
  test.beforeAll(async () => {
    const client = dbClient()
    await client.connect()
    try {
      await client.query(
        `INSERT INTO invoices (supplier_id, buyer_id, total_cost, is_paid, is_payment_requested,
           auto_reminder_count, manual_reminder_count, created_at, updated_at)
         SELECT s.id, c.id, $1, false, true, 0, 0, NOW() - interval '1 day', NOW()
         FROM users s, users c
         WHERE s.email = 'supplier@localhost' AND c.email = 'customer@localhost'`,
        [ORDERING_TOTAL]
      )
      await client.query(
        `INSERT INTO invoices (supplier_id, buyer_id, total_cost, is_paid, is_payment_requested,
           auto_reminder_count, manual_reminder_count, created_at, updated_at)
         SELECT s.id, c.id, $1, false, true, 0, 0, NOW() - interval '2 days', NOW()
         FROM users s, users c
         WHERE s.email = 'supplier@localhost' AND c.email = 'customer2@localhost'`,
        [REJECT_TOTAL]
      )
    } finally {
      await client.end()
    }
  })

  test.afterAll(async () => {
    const client = dbClient()
    await client.connect()
    try {
      await client.query(`DELETE FROM invoices WHERE total_cost IN ($1, $2)`, [
        ORDERING_TOTAL,
        REJECT_TOTAL,
      ])
    } finally {
      await client.end()
    }
  })

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'supplier')
  })

  test('groups invoices by status and sorts newest first inside a group', async ({ page }) => {
    await page.goto('/supplier/payments')
    // The page is titled like its menu entry, and the ordering rule sits behind an (i).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Platby')
    await expect(page.getByTestId('payments-order-hint')).toBeVisible()
    await expect(page.getByText('Faktury jsou seřazeny podle stavu')).toBeHidden()
    await page.getByTestId('payments-order-hint').click()
    await expect(page.getByText(/Faktury jsou seřazeny podle stavu/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.p-datatable tbody tr').first()).toBeVisible()

    const rows = await readRows(page)
    expect(rows.length).toBeGreaterThanOrEqual(4)

    const ranks = rows.map((row) => STATUS_RANK[row.status])
    expect(ranks).not.toContain(undefined)
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1])
    }
    // Seed covers all three states, so every group must be present.
    expect(new Set(ranks)).toEqual(new Set([0, 1, 2]))

    // The freshest payment request (1 day old) leads the awaiting group, ahead of the
    // 7-day-old seeded one, even though a 5-day-old unpaid invoice exists.
    expect(rows[0].status).toBe('Čeká na schválení')
    expect(rows[0].total).toContain(String(ORDERING_TOTAL))
    expect(rows[0].total).toMatch(/Kč$/)
  })

  test('rejecting a payment keeps scroll position, filters and pagination', async ({ page }) => {
    // A short viewport makes the page scroll even with a handful of rows.
    await page.setViewportSize({ width: 1280, height: 400 })
    await page.goto('/supplier/payments?sortBy=totalCost&sortOrder=asc&page=1')

    const row = page.locator('.p-datatable tbody tr', { hasText: /7\s778\sKč/ })
    const status = row.getByTestId('payment-status')
    await expect(status).toHaveText('Čeká na schválení')
    await expect(status).toHaveClass(/bg-amber-100/)
    // The fixed boot-loader overlay stays in the DOM for ~1.6 s after load. While it is there,
    // Playwright's hit-target check for the click can retry and re-scroll the row itself,
    // which would corrupt the before/after comparison below.
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)

    // Scroll the window to the very bottom so the button is fully visible and Playwright's
    // click does not have to nudge the page itself; only the app may move it afterwards.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const rejectButton = row.getByRole('button', { name: 'Zamítnout' })
    await expect(rejectButton).toBeInViewport({ ratio: 1 })
    const scrollBefore = await page.evaluate(() => window.scrollY)
    expect(scrollBefore).toBeGreaterThan(0)

    await rejectButton.click()

    // Rejecting e-mails the buyer, so it asks first — Cancel leaves the request untouched.
    const dialog = page.locator('.p-confirmdialog')
    await expect(dialog).toContainText('Kupující dostane e-mail.')
    await dialog.getByRole('button', { name: 'Zrušit' }).click()
    await expect(dialog).toBeHidden()
    await expect(status).toHaveText('Čeká na schválení')

    await rejectButton.click()
    await dialog.getByRole('button', { name: 'Zamítnout' }).click()

    await expect(page.getByText('Platba byla zamítnuta.')).toBeVisible()
    await expect(status).toHaveText('Nezaplaceno')
    await expect(status).toHaveClass(/bg-red-100/)
    // A settled invoice no longer repeats its status as a tag in the actions column.
    await expect(row.getByRole('button', { name: 'Zamítnout' })).toHaveCount(0)

    // Filters and page survive the redirect, and the viewport did not jump back to the top.
    await expect(page).toHaveURL(/\/supplier\/payments\?sortBy=totalCost&sortOrder=asc&page=1$/)
    const scrollAfter = await page.evaluate(() => window.scrollY)
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2)
  })
})
