import '#tests/test_context'
import { test } from '@japa/runner'
import { normalizeInternalReturnTo } from '#helpers/safe_return_path'

test.group('normalizeInternalReturnTo', () => {
  test('keeps safe internal paths', ({ assert }) => {
    assert.equal(normalizeInternalReturnTo('/profile?tab=security'), '/profile?tab=security')
  })

  test('falls back for external absolute url', ({ assert }) => {
    assert.equal(normalizeInternalReturnTo('https://evil.example/phish'), '/profile')
  })

  test('falls back for protocol-relative path', ({ assert }) => {
    assert.equal(normalizeInternalReturnTo('//evil.example/phish'), '/profile')
  })

  test('falls back for non-root relative path', ({ assert }) => {
    assert.equal(normalizeInternalReturnTo('profile/settings'), '/profile')
  })
})
