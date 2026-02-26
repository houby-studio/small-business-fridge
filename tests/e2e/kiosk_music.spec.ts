import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Kiosk background music', () => {
  async function enterCode(page: import('@playwright/test').Page, code: string) {
    for (const digit of code) {
      await page.getByRole('button', { name: digit, exact: true }).click()
    }
    await page.locator('button:has(.pi-arrow-right)').first().click()
  }

  test('starts playing eligible music after customer sign-in', async ({ page }) => {
    await loginAs(page, 'kiosk')
    await page.goto('/kiosk')

    await enterCode(page, '89992')

    const audio = page.locator('audio')
    await expect(audio).toHaveAttribute('src', /\/uploads\/music\/e2e-public\.mp3/)
  })
})
