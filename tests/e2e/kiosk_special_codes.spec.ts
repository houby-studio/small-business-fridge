import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Kiosk special codes', () => {
  async function enterCode(page: import('@playwright/test').Page, code: string) {
    for (const digit of code) {
      await page.getByRole('button', { name: digit, exact: true }).click()
    }
    await page.locator('button:has(.pi-arrow-right)').first().click()
  }

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'kiosk')
    await page.goto('/kiosk')
    await expect(page).toHaveURL(/\/kiosk/)
  })

  test('logout code logs out the kiosk session', async ({ page }) => {
    await enterCode(page, '000000')

    await expect(page).toHaveURL(/\/$|\/login/)
  })

  test('code 666 shows easter egg and keeps kiosk active', async ({ page }) => {
    await enterCode(page, '666')

    await expect(page).toHaveURL(/\/kiosk/)
    await expect(page.getByText(/easter egg/i)).toBeVisible()
  })
})
