import '#tests/test_context'
import { test } from '@japa/runner'
import { createServerClock } from '../../inertia/composables/use_server_clock.ts'

test.group('Server clock (inventory countedAt)', () => {
  test('the offset is taken when the server time arrives, not when first used', ({ assert }) => {
    // The phone is 5 minutes behind; the sheet loads at server 12:00:00.
    let client = Date.parse('2026-10-04T11:55:00.000Z')
    const clock = createServerClock(() => client)
    clock.sync('2026-10-04T12:00:00.000Z')

    // Eight minutes later the supplier counts the first product.
    client += 8 * 60_000
    assert.equal(clock.now(), '2026-10-04T12:08:00.000Z')
  })

  test('a refresh re-syncs, a missing or broken timestamp falls back to the client', ({
    assert,
  }) => {
    let client = Date.parse('2026-10-04T12:00:00.000Z')
    const clock = createServerClock(() => client)
    clock.sync('2026-10-04T12:00:30.000Z')
    client += 30_000
    clock.sync('2026-10-04T12:01:30.000Z')
    assert.equal(clock.now(), '2026-10-04T12:01:30.000Z')

    clock.sync('not a date')
    assert.equal(clock.now(), '2026-10-04T12:00:30.000Z')
  })
})
