import { test, expect } from '@playwright/test'

test.describe('Invitation registration', () => {
  test('guest can accept invitation and create account', async ({ page }) => {
    await page.goto('/register/invite/e2e-customer-invite-token')
    const submitButton = page.getByRole('button', { name: 'Vytvořit účet' })

    await expect(page.locator('#inviteEmail')).toHaveValue('invitee-e2e@localhost')
    await expect(submitButton).toBeDisabled()

    await page.locator('#inviteDisplayName').fill('Invite E2E User')
    await page.locator('#invitePassword').fill('short')
    await page.locator('#invitePasswordConfirmation').fill('short')
    await expect(submitButton).toBeDisabled()

    await page.locator('#invitePassword').fill('invitee12345')
    await page.locator('#invitePasswordConfirmation').fill('mismatch12345')
    await expect(submitButton).toBeDisabled()

    await page.locator('#invitePasswordConfirmation').fill('invitee12345')
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    await expect(page).toHaveURL(/\/shop/)
  })
})
