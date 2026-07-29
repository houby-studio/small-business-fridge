import '#tests/test_context'
import { test } from '@japa/runner'
import { defineConfig } from '@adonisjs/core/http'
import { parseTrustProxy } from '#config/app'

test.group('parseTrustProxy', () => {
  test('defaults to loopback when unset or empty', ({ assert }) => {
    assert.equal(parseTrustProxy(undefined), 'loopback')
    assert.equal(parseTrustProxy(''), 'loopback')
    assert.equal(parseTrustProxy(' , '), 'loopback')
  })

  test('keeps named presets as-is', ({ assert }) => {
    assert.equal(parseTrustProxy('loopback'), 'loopback')
    assert.equal(parseTrustProxy('uniquelocal'), 'uniquelocal')
  })

  test('maps boolean strings to booleans', ({ assert }) => {
    assert.isTrue(parseTrustProxy('true'))
    assert.isFalse(parseTrustProxy('false'))
  })

  test('keeps a single ip or cidr as a string', ({ assert }) => {
    assert.equal(parseTrustProxy('192.168.202.222'), '192.168.202.222')
    assert.equal(parseTrustProxy('172.16.0.0/12'), '172.16.0.0/12')
  })

  test('compiles a comma-separated list into a matcher function', ({ assert }) => {
    const trust = parseTrustProxy('192.168.202.222,172.64.0.0/13,2a06:98c0::/29')
    assert.isFunction(trust)

    const matches = trust as (address: string, distance: number) => boolean
    assert.isTrue(matches('192.168.202.222', 0), 'the local proxy must be trusted')
    assert.isTrue(matches('172.71.15.66', 1), 'an address inside 172.64.0.0/13 must be trusted')
    assert.isTrue(
      matches('2a06:98c1:3120::9', 1),
      'an address inside 2a06:98c0::/29 must be trusted'
    )
    assert.isFalse(matches('212.47.29.6', 2), 'a real client address must NOT be trusted')
    assert.isFalse(matches('192.168.200.1', 0), 'an unlisted LAN address must NOT be trusted')
  })

  test('tolerates whitespace around list entries', ({ assert }) => {
    const trust = parseTrustProxy(' 10.0.0.5 , 172.64.0.0/13 ') as (
      address: string,
      distance: number
    ) => boolean
    assert.isFunction(trust)
    assert.isTrue(trust('10.0.0.5', 0))
    assert.isTrue(trust('172.64.0.1', 1))
    assert.isFalse(trust('10.0.0.6', 0))
  })

  /**
   * Regression guard: a comma-separated list used to be returned as one string,
   * which proxy-addr rejects with "invalid IP address" while defineConfig runs —
   * i.e. the app never finishes booting. Every documented form must survive the
   * same normalization the HTTP server applies at startup.
   */
  test('every documented form survives http defineConfig', ({ assert }) => {
    const inputs = [
      undefined,
      '',
      'loopback',
      'uniquelocal',
      'true',
      'false',
      '192.168.202.222',
      '172.16.0.0/12',
      '192.168.202.222,172.64.0.0/13,131.0.72.0/22,2a06:98c0::/29',
    ]

    for (const input of inputs) {
      // Not assert.doesNotThrow — its second argument is an error matcher, not a
      // message, so a mismatching error would silently pass the assertion.
      let thrown: unknown = null
      try {
        defineConfig({ trustProxy: parseTrustProxy(input) })
      } catch (error) {
        thrown = error
      }

      assert.isNull(
        thrown,
        `TRUST_PROXY=${String(input)} broke the HTTP server config: ${
          thrown instanceof Error ? thrown.message : String(thrown)
        }`
      )
    }
  })
})
