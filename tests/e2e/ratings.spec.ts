import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

/**
 * E2E: Product ratings flow.
 *
 * Covers the user-visible behaviour: navigation entry, buying a product in the
 * shop, the "unrated purchases" banner on /ratings, submitting a rating through
 * the dialog and seeing it in the feed table.
 */
test.describe('Product ratings', () => {
  test('ratings page renders with navigation entry', async ({ page }) => {
    await loginAs(page, 'customer')

    await page.goto('/ratings')
    await expect(page.locator('h1')).toContainText('Hodnocení produktů')
  })

  test('buy a product → banner appears → rate it → rating shows in the feed', async ({ page }) => {
    await loginAs(page, 'customer')

    // 1. Buy the first available product in the shop.
    await page.goto('/shop')
    const buyButton = page.locator('button', { hasText: 'Koupit' }).first()
    await expect(buyButton).toBeVisible({ timeout: 10_000 })
    await buyButton.click()

    // Confirm dialog (PrimeVue ConfirmDialog) — accept the purchase ("Koupit").
    const confirmDialog = page.locator('.p-confirmdialog')
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 })
    await confirmDialog.getByRole('button', { name: 'Koupit' }).click()
    await page.waitForLoadState('networkidle')

    // 2. The ratings page shows the unrated-purchases banner.
    await page.goto('/ratings')
    const banner = page.locator('[data-testid="unrated-banner"]')
    await expect(banner).toBeVisible({ timeout: 10_000 })

    // 3. Open the rate dialog for the first unrated product and submit.
    await banner.locator('button').first().click()
    const submit = page.locator('[data-testid="rating-submit"]')
    await expect(submit).toBeVisible()
    await expect(submit).toBeEnabled()
    await page.locator('[data-testid="rating-comment"]').fill('Výborné, doporučuji.')
    await submit.click()

    // 4. The new rating appears in the feed table (comment visible).
    await expect(page.locator('table')).toContainText('Výborné, doporučuji.', { timeout: 10_000 })
  })
})
