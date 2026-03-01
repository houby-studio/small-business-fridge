import '#tests/test_context'
import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import {
  AUDIT_ACTION_I18N_KEYS,
  formatUnknownAuditAction,
  getAuditActionLabel,
} from '../../inertia/composables/use_audit_actions.ts'

test.group('Audit action translations', () => {
  test('every audit action key used by UI exists in both en and cs translation files', async ({
    assert,
  }) => {
    const en = JSON.parse(
      await readFile(app.makePath('resources/lang/en/audit.json'), 'utf8')
    ) as Record<string, string>
    const cs = JSON.parse(
      await readFile(app.makePath('resources/lang/cs/audit.json'), 'utf8')
    ) as Record<string, string>

    for (const translationKey of Object.values(AUDIT_ACTION_I18N_KEYS)) {
      const key = translationKey.replace('audit.', '')
      assert.property(en, key)
      assert.property(cs, key)
      assert.isString(en[key])
      assert.isString(cs[key])
      assert.notEqual(en[key], '')
      assert.notEqual(cs[key], '')
    }
  })

  test('known action resolves via translation key and unknown action is humanized', ({
    assert,
  }) => {
    const fakeT = (key: string) => `__${key}__`

    assert.equal(getAuditActionLabel('music.created', fakeT), '__audit.action_music_created__')
    assert.equal(
      getAuditActionLabel('user.identity.linked', fakeT),
      '__audit.action_user_identity_linked__'
    )

    const unknown = getAuditActionLabel('custom.action_name', fakeT)
    assert.equal(unknown, 'custom action name')
    assert.notInclude(unknown, '.')
    assert.notInclude(unknown, '_')
  })

  test('fallback formatter removes separators and lowercases labels', ({ assert }) => {
    assert.equal(formatUnknownAuditAction('One.TWO_three'), 'one two three')
  })
})
