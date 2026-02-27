import { test, expect } from '@playwright/test'

test.describe('Invitation registration', () => {
  test('guest can accept invitation and create account', async ({ page }) => {
    await page.goto('/register/invite/e2e-customer-invite-token')

    await expect(page.locator('#inviteEmail')).toHaveValue('invitee-e2e@localhost')
    await page.locator('#inviteDisplayName').fill('Invite E2E User')
    await page.locator('#inviteUsername').fill('invitee-e2e')
    await page.locator('#invitePassword').fill('invitee12345')
    await page.locator('#invitePasswordConfirmation').fill('invitee12345')
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/shop/)
  })
})
