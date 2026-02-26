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
})
