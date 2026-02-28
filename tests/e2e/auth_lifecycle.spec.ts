import { test, expect } from '@playwright/test'
import { ensureLoginPage, fillLoginForm } from './helpers/auth'

test.describe('Authentication lifecycle', () => {
  test('guest can register local account', async ({ page }) => {
    await page.goto('/register')
    const submitButton = page.getByRole('button', { name: 'Vytvořit účet' })
    await expect(submitButton).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Přihlásit se místo toho' })).toHaveAttribute(
      'href',
      '/login'
    )

    const suffix = Date.now().toString()
    await page.locator('#registerDisplayName').fill(`E2E Register ${suffix}`)
    await page.locator('#registerEmail').fill('bad-email')
    await page.locator('#registerUsername').fill('x')
    await expect(submitButton).toBeDisabled()

    await page.locator('#registerEmail').fill(`e2e-register-${suffix}@localhost`)
    await page.locator('#registerUsername').fill(`e2eregister${suffix}`)
    await page.locator('#registerPassword').fill('short')
    await page.locator('#registerPasswordConfirmation').fill('short')
    await expect(submitButton).toBeDisabled()

    await page.locator('#registerPassword').fill('register123')
    await page.locator('#registerPasswordConfirmation').fill('mismatch123')
    await expect(submitButton).toBeDisabled()

    await page.locator('#registerPasswordConfirmation').fill('register123')
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    await expect(page).toHaveURL(/\/shop/)
  })

  test('guest can reset password using reset token link', async ({ page }) => {
    await page.goto('/reset-password/e2e-reset-token')
    const submitButton = page.getByRole('button', { name: 'Změnit heslo' })
    await expect(submitButton).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Zpět na přihlášení' })).toHaveAttribute(
      'href',
      '/login'
    )

    await page.locator('#resetPassword').fill('short')
    await page.locator('#resetPasswordConfirmation').fill('short')
    await expect(submitButton).toBeDisabled()

    await page.locator('#resetPassword').fill('reset12345')
    await page.locator('#resetPasswordConfirmation').fill('mismatch123')
    await expect(submitButton).toBeDisabled()

    await page.locator('#resetPasswordConfirmation').fill('reset12345')
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    await expect(page).toHaveURL(/\/login/)

    await ensureLoginPage(page)
    await fillLoginForm(page, 'resetuser', 'reset12345')
    await expect(page).toHaveURL(/\/shop/)
  })

  test('forgot password form blocks invalid email and links back to login', async ({ page }) => {
    await page.goto('/forgot-password')

    const submitButton = page.getByRole('button', { name: 'Odeslat odkaz' })
    await expect(submitButton).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Zpět na přihlášení' })).toHaveAttribute(
      'href',
      '/login'
    )

    await page.locator('#forgotEmail').fill('invalid-email')
    await expect(submitButton).toBeDisabled()

    await page.locator('#forgotEmail').fill('valid-user@example.com')
    await expect(submitButton).toBeEnabled()
  })
})
