import { test, expect } from '@playwright/test'
import pg from 'pg'
import { ensureLoginPage, fillLoginForm, loginAs } from './helpers/auth'

const { Client } = pg

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
    await expect(submitButton).toBeDisabled()

    await page.locator('#registerEmail').fill(`e2e-register-${suffix}@localhost`)
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
    await fillLoginForm(page, 'resetuser@localhost', 'reset12345')
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

  test('profile shows unverified status and resend action when email is not verified', async ({
    page,
  }) => {
    const client = new Client({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER ?? 'sbf',
      password: process.env.DB_PASSWORD ?? 'sbf',
      database: process.env.DB_DATABASE ?? 'sbf_test',
    })

    await client.connect()
    await client.query(
      `UPDATE users
       SET email_verified_at = NULL,
           pending_email = 'customer-new@localhost'
       WHERE email = 'customer@localhost'`
    )

    try {
      await loginAs(page, 'customer')
      await page.goto('/profile')

      await expect(page.getByTestId('profile-overview')).toBeVisible()
      await expect(page.getByTestId('profile-contact-card')).toBeVisible()
      await expect(page.getByTestId('profile-preferences-card')).toBeVisible()
      await expect(page.getByTestId('profile-security-card')).toBeVisible()
      await expect(page.getByTestId('profile-api-tokens-card')).toBeVisible()

      await expect(
        page.getByTestId('profile-contact-card').getByText('E-mail není ověřen')
      ).toBeVisible()
      await expect(page.getByTestId('profile-pending-email')).toContainText(
        'customer-new@localhost'
      )
      await expect(page.getByTestId('profile-pending-email')).toContainText('Aktivní e-mail')
      await expect(page.getByTestId('profile-pending-email')).toContainText('customer@localhost')
      await expect(
        page.getByRole('button', { name: 'Znovu odeslat ověřovací e-mail' })
      ).toBeVisible()
    } finally {
      await client.query(
        `UPDATE users
         SET email_verified_at = NOW(),
             pending_email = NULL
         WHERE email = 'customer@localhost'`
      )
      await client.end()
    }
  })
})
