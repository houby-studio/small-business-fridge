import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

/**
 * Confirm dialogs follow the dialog standard (CLAUDE.md): Cancel is a quiet secondary text
 * button, the action is the only filled one — red when it is destructive.
 */
test.describe('Confirm dialog buttons', () => {
  test('shop purchase confirm has a quiet Cancel and a filled primary action', async ({ page }) => {
    await loginAs(page, 'customer')
    await page.getByRole('button', { name: 'Koupit' }).first().click()

    const dialog = page.locator('.p-confirmdialog')
    await expect(dialog).toBeVisible()
    const cancel = dialog.getByRole('button', { name: 'Zrušit' })
    await expect(cancel).toHaveClass(/p-button-secondary/)
    await expect(cancel).toHaveClass(/p-button-text/)
    const accept = dialog.getByRole('button', { name: 'Koupit' })
    await expect(accept).not.toHaveClass(/p-button-text/)
    await expect(accept).not.toHaveClass(/p-button-danger/)

    await cancel.click()
    await expect(dialog).toBeHidden()
  })

  test('destructive confirm uses a red action and a quiet Cancel', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/orders')
    await page.getByRole('button', { name: 'Storno' }).first().click()

    const dialog = page.locator('.p-confirmdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Zrušit' })).toHaveClass(/p-button-text/)
    await expect(dialog.getByRole('button', { name: 'Stornovat' })).toHaveClass(/p-button-danger/)

    // Nothing is cancelled — the dialog is only inspected.
    await dialog.getByRole('button', { name: 'Zrušit' }).click()
    await expect(dialog).toBeHidden()
  })
})
