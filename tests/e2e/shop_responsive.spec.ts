import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

async function firstTwoCardPositions(page: import('@playwright/test').Page) {
  return page.locator('.sbf-card').evaluateAll((cards) => {
    const first = cards[0]?.getBoundingClientRect()
    const second = cards[1]?.getBoundingClientRect()

    if (!first || !second) return null

    return {
      firstX: first.x,
      firstY: first.y,
      secondX: second.x,
      secondY: second.y,
    }
  })
}

test.describe('Shop UI responsiveness', () => {
  test('shop grid and category filters remain usable across mobile and desktop sizes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, 'supplier')
    await page.waitForLoadState('load')

    let positions = await firstTwoCardPositions(page)
    expect(positions).not.toBeNull()
    expect(Math.abs(positions!.firstX - positions!.secondX)).toBeLessThan(8)
    expect(positions!.secondY).toBeGreaterThan(positions!.firstY + 20)

    const allButton = page.getByRole('button', { name: 'Vše' })
    await expect(allButton).toBeVisible()
    await page.getByRole('button', { name: 'Nealko' }).click()
    await expect(page.getByRole('button', { name: 'Nealko' })).toBeVisible()

    await page.setViewportSize({ width: 1366, height: 900 })
    positions = await firstTwoCardPositions(page)
    expect(positions).not.toBeNull()
    expect(Math.abs(positions!.firstY - positions!.secondY)).toBeLessThan(8)
    expect(positions!.secondX).toBeGreaterThan(positions!.firstX + 20)
  })
})
