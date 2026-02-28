import '#tests/test_context'
import { test } from '@japa/runner'
import { extractFlashToastMessages } from '../../inertia/composables/use_flash.ts'

test.group('Flash toast message extraction', () => {
  test('maps alert + errors bags into toast payloads', ({ assert }) => {
    const messages = extractFlashToastMessages({
      alert: { type: 'danger', message: 'Top-level alert' },
      errorsBag: {
        E_VALIDATION_ERROR: 'Form failed validation',
      } as any,
      inputErrorsBag: {
        email: ['Email is invalid'],
        username: ['Username too short'],
      } as any,
    } as any)

    assert.deepEqual(messages, [
      { severity: 'error', summary: 'Top-level alert', life: 4000 },
      { severity: 'error', summary: 'Form failed validation', life: 5000 },
      { severity: 'error', summary: 'Email is invalid', life: 5000 },
      { severity: 'error', summary: 'Username too short', life: 5000 },
    ])
  })

  test('returns empty list for missing/empty flash payloads', ({ assert }) => {
    assert.deepEqual(extractFlashToastMessages(undefined), [])
    assert.deepEqual(extractFlashToastMessages({} as any), [])
  })
})
