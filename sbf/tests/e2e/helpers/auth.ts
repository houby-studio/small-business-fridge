import { expect, type Page } from '@playwright/test'

export type TestUser = 'admin' | 'supplier' | 'customer' | 'customer2' | 'kiosk'

const PASSWORDS: Record<TestUser, string> = {
  admin: 'admin123',
  supplier: 'supplier123',
  customer: 'customer123',
  customer2: 'customer123',
  kiosk: 'kiosk123',
}

const cachedSessionCookies = new Map<string, any[]>()

function resolveSessionKey(user: TestUser) {
  if (user === 'customer2') return 'customer'
  return user
}

export async function fillLoginForm(page: Page, username: string, password: string) {
  await page.waitForLoadState('domcontentloaded')

  const usernameInput = page.locator('#username')
  const passwordInput = page.locator('#password')

  await expect(usernameInput).toBeVisible()
  await expect(passwordInput).toBeVisible()

  await usernameInput.fill(username)
  await expect(usernameInput).toHaveValue(username)

  await passwordInput.fill(password)
  await expect(passwordInput).toHaveValue(password)

  await page.locator('button[type="submit"]').click()
}

async function tryLogin(page: Page, username: string, password: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    if (!/\/login(?:\?|$)/.test(page.url())) {
      return true
    }

    await fillLoginForm(page, username, password)
    await page.waitForLoadState('networkidle')

    if (!/\/login(?:\?|$)/.test(page.url())) {
      return true
    }

    await page.waitForTimeout(250)
  }

  return false
}

async function tryWithCachedSession(page: Page, sessionKey: string) {
  const cookies = cachedSessionCookies.get(sessionKey)
  if (!cookies?.length) return false

  await page.context().clearCookies()
  await page.context().addCookies(cookies)
  await page.goto('/shop')
  await page.waitForLoadState('networkidle')
  return !/\/login(?:\?|$)/.test(page.url())
}

async function rememberSession(page: Page, sessionKey: string) {
  const cookies = await page.context().cookies()
  cachedSessionCookies.set(sessionKey, cookies)
}

export async function loginAs(page: Page, user: TestUser) {
  const sessionKey = resolveSessionKey(user)

  await page.goto('/shop')
  await page.waitForLoadState('networkidle')
  if (!/\/login(?:\?|$)/.test(page.url())) {
    await rememberSession(page, sessionKey)
    return
  }

  if (await tryWithCachedSession(page, sessionKey)) {
    await expect(page).not.toHaveURL(/\/login/)
    return
  }

  const succeeded = await tryLogin(page, user, PASSWORDS[user])
  if (succeeded) {
    await rememberSession(page, sessionKey)
    await expect(page).not.toHaveURL(/\/login/)
    return
  }

  await expect(page).not.toHaveURL(/\/login/)
}
