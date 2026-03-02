import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

async function noHorizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
}

test.describe('App layout responsiveness', () => {
  test('app bar adapts across breakpoints without overlap or clipping', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await loginAs(page, 'admin')
    await page.waitForLoadState('load')

    const nav = page.locator('.sbf-nav')
    const main = page.locator('.sbf-main')
    await expect(nav).toBeVisible()
    await expect(main).toBeVisible()

    const navBox = await nav.boundingBox()
    const mainBox = await main.boundingBox()
    expect(navBox).not.toBeNull()
    expect(mainBox).not.toBeNull()
    expect(mainBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 1)

    await expect(page.locator('.sbf-brand-link')).toBeVisible()
    await expect(page.locator('.sbf-nav-profile-name')).toBeVisible()
    expect(await noHorizontalOverflow(page)).toBeTruthy()

    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.locator('.sbf-nav-profile-name')).toHaveCount(1)

    const profileDisplay = await page
      .locator('.sbf-nav-profile-name')
      .evaluate((el) => getComputedStyle(el).display)
    expect(profileDisplay).toBe('none')

    const compactLabelsHidden = await page
      .locator('.sbf-nav-compact-target .sbf-nav-item-label')
      .evaluateAll(
        (nodes) =>
          nodes.length > 0 && nodes.every((node) => getComputedStyle(node).display === 'none')
      )
    expect(compactLabelsHidden).toBeTruthy()
    expect(await noHorizontalOverflow(page)).toBeTruthy()

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.sbf-nav-profile-name')).toBeVisible()
    const compactLabelsVisible = await page
      .locator('.sbf-nav-compact-target .sbf-nav-item-label')
      .evaluateAll(
        (nodes) =>
          nodes.length > 0 && nodes.every((node) => getComputedStyle(node).display !== 'none')
      )
    expect(compactLabelsVisible).toBeTruthy()
    expect(await noHorizontalOverflow(page)).toBeTruthy()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.sbf-brand-link')).toBeHidden()
    await expect(page.locator('.p-menubar-button')).toBeVisible()
    await expect(page.locator('button[aria-label="Odhlásit se"]')).toBeVisible()
    await page.locator('.p-menubar-button').click()
    await expect(page.locator('a[href="/orders"]').first()).toBeVisible()
    expect(await noHorizontalOverflow(page)).toBeTruthy()
  })
})
