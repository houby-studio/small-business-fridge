import { test, expect } from '@playwright/test'
import { ensureLoginPage, fillLoginForm } from './helpers/auth'

test.describe('Authentication lifecycle', () => {
  test('guest can register local account', async ({ page }) => {
    await page.goto('/register')

    const suffix = Date.now().toString()
    await page.locator('#registerDisplayName').fill(`E2E Register ${suffix}`)
    await page.locator('#registerEmail').fill(`e2e-register-${suffix}@localhost`)
    await page.locator('#registerUsername').fill(`e2eregister${suffix}`)
    await page.locator('#registerPassword').fill('register123')
    await page.locator('#registerPasswordConfirmation').fill('register123')
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/shop/)
  })

  test('guest can reset password using reset token link', async ({ page }) => {
    await page.goto('/reset-password/e2e-reset-token')
    await page.locator('#resetPassword').fill('reset12345')
    await page.locator('#resetPasswordConfirmation').fill('reset12345')
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/login/)

    await ensureLoginPage(page)
    await fillLoginForm(page, 'resetuser', 'reset12345')
    await expect(page).toHaveURL(/\/shop/)
  })
})
