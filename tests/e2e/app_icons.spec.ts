import { test, expect } from '@playwright/test'

/**
 * Runs against the production build, so this also proves the icon files are
 * copied into `build/public` and reachable by browsers and installers.
 */
test.describe('App icons and manifest', () => {
  test('the page head declares the icon set', async ({ page }) => {
    await page.goto('/login')

    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1)
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1)
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
    await expect(page.locator('link[rel="manifest"][href="/site.webmanifest"]')).toHaveCount(1)
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2)
  })

  test('every declared icon is served and decodes as an image', async ({ page }) => {
    await page.goto('/login')

    const sources = await page
      .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).getAttribute('href')!))

    expect(sources.length).toBeGreaterThan(0)

    for (const src of sources) {
      const response = await page.request.get(src)
      expect(response.status(), `${src} should be served`).toBe(200)

      // .ico is not decodable via Image() in every engine, so only check bitmaps/SVG
      if (src.endsWith('.ico')) continue

      const size = await page.evaluate(async (url) => {
        const image = new Image()
        image.src = url
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, src)

      expect(size.width, `${src} should decode`).toBeGreaterThan(0)
      expect(size.height).toBe(size.width)
    }
  })

  test('the manifest is installable and points at existing icons', async ({ page }) => {
    await page.goto('/login')

    const response = await page.request.get('/site.webmanifest')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/manifest+json')

    const manifest = JSON.parse(await response.text())
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3)

    for (const icon of manifest.icons as { src: string }[]) {
      const iconResponse = await page.request.get(icon.src)
      expect(iconResponse.status(), `${icon.src} from manifest should be served`).toBe(200)
    }
  })
})
