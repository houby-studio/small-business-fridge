import '#tests/test_context'
import { test } from '@japa/runner'
import {
  getCurrencyCode,
  normalizeCurrencyCode,
  resolveCurrencyDisplay,
} from '#services/currency_service'

test.group('CurrencyService', () => {
  test('normalizes valid ISO currency codes', ({ assert }) => {
    assert.equal(normalizeCurrencyCode('usd'), 'USD')
    assert.equal(normalizeCurrencyCode(' czk '), 'CZK')
  })

  test('falls back to CZK for invalid currency values', ({ assert }) => {
    assert.equal(normalizeCurrencyCode('$'), 'CZK')
    assert.equal(normalizeCurrencyCode('usdx'), 'CZK')
    assert.equal(normalizeCurrencyCode(''), 'CZK')
  })

  test('reads currency code from env and applies fallback', ({ assert }) => {
    const originalCurrency = process.env.CURRENCY

    process.env.CURRENCY = 'eur'
    assert.equal(getCurrencyCode(), 'EUR')

    process.env.CURRENCY = 'not-a-code'
    assert.equal(getCurrencyCode(), 'CZK')

    if (originalCurrency === undefined) {
      delete process.env.CURRENCY
    } else {
      process.env.CURRENCY = originalCurrency
    }
  })

  test('resolves locale-aware currency display token', ({ assert }) => {
    const csDisplay = resolveCurrencyDisplay('CZK', 'cs')
    const enDisplay = resolveCurrencyDisplay('CZK', 'en')

    assert.isTrue(csDisplay.length > 0)
    assert.isTrue(enDisplay.length > 0)
  })
})
