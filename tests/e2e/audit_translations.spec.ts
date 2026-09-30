import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'

async function assertNoRawAuditActionTokens(page: Page) {
  const texts = await page.locator('table .p-tag').allTextContents()
  expect(texts.length).toBeGreaterThan(0)

  for (const raw of texts) {
    const text = raw.trim()
    expect(text).not.toMatch(/audit\.action_/i)
    expect(text).not.toMatch(/\b[a-z]+(?:[._][a-z]+)+\b/)
  }
}

test.describe('Audit action translations', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin')
  })

  test('customer audit page shows translated action labels', async ({ page }) => {
    await page.goto('/audit')

    await expect(page.getByText('Skladba vytvořena').first()).toBeVisible()
    await assertNoRawAuditActionTokens(page)
  })

  test('admin audit page shows translated action labels', async ({ page }) => {
    await page.goto('/admin/audit')

    await expect(page.getByText('Skladba vytvořena').first()).toBeVisible()
    await assertNoRawAuditActionTokens(page)
  })

  test('admin audit page labels system entries and names nested references', async ({ page }) => {
    // Other specs keep adding entries, so filter down to the seeded ones (oldest first).
    await page.goto('/admin/audit?action=user.anonymized&sortOrder=asc')
    await expect(page.getByText('Účet anonymizován').first()).toBeVisible()

    await page.goto('/admin/audit?action=order.created&sortOrder=asc')
    // A nested { id, name } is shown by its name, not dumped as JSON.
    await expect(page.getByText('kiosk: E2E Kiosk Terminal').first()).toBeVisible()
    await expect(page.getByText('{"id":1')).toHaveCount(0)
  })
})
