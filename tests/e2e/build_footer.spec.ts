import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Build footer', () => {
  test('shows the running build under the page content', async ({ page }) => {
    await loginAs(page, 'customer')
    await page.waitForLoadState('load')

    const footer = page.getByTestId('app-build-info')
    await expect(footer).toBeVisible()

    // Local and CI runs have no build metadata baked in, so the app reports itself as `dev`.
    // A released image shows the version instead, optionally with a short commit.
    await expect(footer).toContainText(/\bdev\b|\d+\.\d+\.\d+/)
  })

  test('footer fits on a phone without causing horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'customer')
    await page.waitForLoadState('load')

    // `.sbf-main` animates in, so anything measured before the boot loader is gone and the
    // animation has settled reports a position the user never actually sees.
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const footer = page.getByTestId('app-build-info')
    await expect(footer).toBeVisible()

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
    expect(noOverflow).toBe(true)

    // The footer is the last thing in the layout; assert document order rather than
    // pixel geometry, which is what the entrance animation makes flaky.
    const footerIsAfterMain = await page.evaluate(() => {
      const main = document.querySelector('.sbf-main')
      const foot = document.querySelector('[data-testid="app-build-info"]')
      if (!main || !foot) return false
      return !!(main.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(footerIsAfterMain).toBe(true)
  })
})
