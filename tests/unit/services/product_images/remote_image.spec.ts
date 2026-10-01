import '#tests/test_context'
import { test } from '@japa/runner'
import { fetchRemoteImage, isBlockedAddress } from '#services/product_images/remote_image'
import { isDomainError } from '#services/domain_error'
import { productOnBackdrop, startStubServer } from '#tests/utils/product_image_fixtures'

async function expectCode(promise: Promise<unknown>, code: string, assert: any) {
  try {
    await promise
    assert.fail(`expected ${code}`)
  } catch (error) {
    assert.isTrue(isDomainError(error, code), `got ${(error as Error).message}`)
  }
}

test.group('Product images - remote image download', () => {
  test('blocks private, loopback, link-local and mapped addresses', ({ assert }) => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      assert.isTrue(isBlockedAddress(address), address)
    }
    for (const address of ['1.1.1.1', '151.101.1.1', '2606:4700::1111']) {
      assert.isFalse(isBlockedAddress(address), address)
    }
  })

  test('refuses localhost and literal private IPs', async ({ assert }) => {
    await expectCode(
      fetchRemoteImage('http://localhost:1/x.png', { maxBytes: 1000 }),
      'image_url_blocked',
      assert
    )
    await expectCode(
      fetchRemoteImage('http://169.254.169.254/latest/meta-data', { maxBytes: 1000 }),
      'image_url_blocked',
      assert
    )
    await expectCode(
      fetchRemoteImage('http://[::1]:1/x.png', { maxBytes: 1000 }),
      'image_url_blocked',
      assert
    )
  })

  test('refuses non-http schemes and credentials in the URL', async ({ assert }) => {
    await expectCode(
      fetchRemoteImage('file:///etc/passwd', { maxBytes: 1000 }),
      'image_url_invalid',
      assert
    )
    await expectCode(
      fetchRemoteImage('https://user:pw@example.com/x.png', { maxBytes: 1000 }),
      'image_url_invalid',
      assert
    )
    await expectCode(fetchRemoteImage('not a url', { maxBytes: 1000 }), 'image_url_invalid', assert)
  })

  test('downloads an image and follows a redirect', async ({ assert }) => {
    const png = await productOnBackdrop({ product: { width: 10, height: 10 } })
    const server = await startStubServer((req, _body, res) => {
      if (req.url === '/old') {
        res.writeHead(302, { Location: '/new.png' }).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(png)
    })
    try {
      const buffer = await fetchRemoteImage(`${server.url}/old`, {
        maxBytes: 1_000_000,
        allowPrivateNetwork: true,
      })
      assert.deepEqual(buffer, png)
    } finally {
      await server.close()
    }
  })

  test('validates every redirect hop again', async ({ assert }) => {
    const server = await startStubServer((_req, _body, res) => {
      res.writeHead(302, { Location: 'file:///etc/passwd' }).end()
    })
    try {
      await expectCode(
        fetchRemoteImage(`${server.url}/x`, { maxBytes: 1000, allowPrivateNetwork: true }),
        'image_url_invalid',
        assert
      )
    } finally {
      await server.close()
    }
  })

  test('rejects a non-image response and an oversized one', async ({ assert }) => {
    const server = await startStubServer((req, _body, res) => {
      if (req.url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>')
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.alloc(5000))
    })
    try {
      const opts = { maxBytes: 1000, allowPrivateNetwork: true }
      await expectCode(fetchRemoteImage(`${server.url}/html`, opts), 'image_url_not_image', assert)
      await expectCode(fetchRemoteImage(`${server.url}/big`, opts), 'image_url_too_large', assert)
    } finally {
      await server.close()
    }
  })
})
