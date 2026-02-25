import '#tests/test_context'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { mkdir, rm, writeFile } from 'node:fs/promises'

test.group('Uploads caching', (group) => {
  const productsDir = app.makePath('storage/uploads/products')
  const imageFile = app.makePath('storage/uploads/products/cache-test-image.png')
  const textFile = app.makePath('storage/uploads/products/cache-test-doc.txt')

  group.each.setup(async () => {
    await mkdir(productsDir, { recursive: true })
    await writeFile(imageFile, 'fake image data')
    await writeFile(textFile, 'plain text')
  })

  group.each.teardown(async () => {
    await rm(imageFile, { force: true })
    await rm(textFile, { force: true })
  })

  test('serves uploaded images with long immutable cache policy', async ({ client }) => {
    const response = await client.get('/uploads/products/cache-test-image.png')

    response.assertStatus(200)
    response.assertHeader('cache-control', 'public, max-age=31536000, immutable')
  })

  test('serves non-image uploads with short cache policy', async ({ client }) => {
    const response = await client.get('/uploads/products/cache-test-doc.txt')

    response.assertStatus(200)
    response.assertHeader('cache-control', 'public, max-age=3600')
  })
})
