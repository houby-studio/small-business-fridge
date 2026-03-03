import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Kiosk special codes', () => {
  async function enterCode(page: import('@playwright/test').Page, code: string) {
    for (const digit of code) {
      await page.getByRole('button', { name: digit, exact: true }).click()
    }
    await page.locator('button:has(.pi-arrow-right)').first().click()
  }

  async function enterCodeByKeyboard(page: import('@playwright/test').Page, code: string) {
    await page.keyboard.type(code)
    await page.keyboard.press('Enter')
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

  test('keyboard entry works on /kiosk without focused input', async ({ page }) => {
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '')
    expect(activeTag).not.toBe('INPUT')

    await enterCodeByKeyboard(page, '666')

    await expect(page).toHaveURL(/\/kiosk/)
    await expect(page.getByText(/easter egg/i)).toBeVisible()
  })

  test('plays keypad tones on click and keyboard press', async ({ page }) => {
    await page.evaluate(() => {
      const calls: string[] = []
      ;(window as Window & { __keypadToneCalls?: string[] }).__keypadToneCalls = calls

      HTMLMediaElement.prototype.play = function playStub() {
        calls.push(this.currentSrc || this.getAttribute('src') || '')
        return Promise.resolve()
      }
    })

    await page.getByRole('button', { name: '1', exact: true }).click()
    await page.keyboard.press('2')

    const calls = await page.evaluate(
      () => (window as Window & { __keypadToneCalls?: string[] }).__keypadToneCalls ?? []
    )

    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.some((src) => src.includes('/uploads/keypad/1.wav'))).toBeTruthy()
    expect(calls.some((src) => src.includes('/uploads/keypad/2.wav'))).toBeTruthy()
  })
})
