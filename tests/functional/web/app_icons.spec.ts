import { test } from '@japa/runner'

const ICON_FILES = [
  '/favicon.ico',
  '/favicon.svg',
  '/icon.svg',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]

test.group('App icons', () => {
  test('serves every generated icon file', async ({ client, assert }) => {
    for (const path of ICON_FILES) {
      const response = await client.get(path)

      response.assertStatus(200)
      assert.isAbove(
        Number(response.header('content-length') ?? 0),
        0,
        `${path} was served but is empty`
      )
    }
  })

  test('links the icon set from the root layout', async ({ client, assert }) => {
    const response = await client.get('/login')
    response.assertStatus(200)

    const html = response.text()
    assert.include(html, '<link rel="icon" href="/favicon.ico" sizes="32x32" />')
    assert.include(html, '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />')
    assert.include(html, '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    assert.include(html, '<link rel="manifest" href="/site.webmanifest" />')
    assert.include(html, 'name="theme-color"')
  })
})

test.group('Web app manifest', () => {
  test('exposes the app name, icons and PWA metadata', async ({ client, assert }) => {
    const response = await client.get('/site.webmanifest')

    response.assertStatus(200)
    assert.include(response.header('content-type') ?? '', 'application/manifest+json')

    const manifest = JSON.parse(response.text())
    assert.equal(manifest.name, 'Test') // APP_NAME from .env.test
    assert.equal(manifest.start_url, '/')
    assert.equal(manifest.display, 'standalone')
    assert.equal(manifest.theme_color, '#09090b')
    assert.equal(manifest.lang, 'cs')

    const sources = manifest.icons.map((icon: { src: string }) => icon.src)
    assert.includeMembers(sources, [
      '/favicon.svg',
      '/icon-192.png',
      '/icon-512.png',
      '/icon-maskable-512.png',
    ])
    assert.isTrue(
      manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable'),
      'manifest must advertise a maskable icon for Android'
    )
  })

  test('is reachable without a session', async ({ client }) => {
    const response = await client.get('/site.webmanifest')

    response.assertStatus(200)
  })
})
