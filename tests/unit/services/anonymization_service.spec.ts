import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import AnonymizationService from '#services/anonymization_service'
import AuthIdentityService from '#services/auth_identity_service'

const service = new AnonymizationService()
const authIdentity = new AuthIdentityService()

test.group('AnonymizationService', (group) => {
  group.each.setup(async () => {
    // CASCADE on users sweeps every dependent row in one statement.
    // audit_logs and password_reset_tokens have no FK to users, so wipe them too.
    await db.rawQuery(
      'TRUNCATE TABLE audit_logs, password_reset_tokens, users RESTART IDENTITY CASCADE'
    )
  })

  test('refuses to anonymize an active (non-disabled) user', async ({ assert }) => {
    const user = await UserFactory.create()

    await assert.rejects(() => service.anonymizeUser(user.id), 'CANNOT_ANONYMIZE_ACTIVE_USER')

    await user.refresh()
    assert.isNull(user.anonymizedAt)
    assert.notMatch(user.email, /@anon$/)
  })

  test('wipes PII and detaches identities for a disabled user', async ({ assert }) => {
    const user = await UserFactory.apply('disabled')
      .merge({
        email: 'jan.novak@example.com',
        phone: '+420123456789',
        iban: 'CZ1234567890123456789012',
        cardId: 'CARD-1',
      })
      .create()
    user.disabledAt = DateTime.utc().minus({ days: 10 })
    await user.save()

    await authIdentity.ensureLinkedIdentity({
      userId: user.id,
      provider: 'microsoft',
      providerUserId: 'entra-oid-1',
      providerEmail: user.email,
      providerEmailVerified: true,
    })

    const ok = await service.anonymizeUser(user.id)
    assert.isTrue(ok)

    await user.refresh()
    assert.equal(user.displayName, `Deleted user #${user.id}`)
    assert.equal(user.email, `deleted-${user.id}@anon`)
    assert.isNull(user.phone)
    assert.isNull(user.iban)
    assert.isNull(user.cardId)
    assert.isNull(user.keypadId)
    assert.isNull(user.password)
    assert.isNotNull(user.anonymizedAt)
    assert.isTrue(user.isDisabled)

    const identityRows = await db
      .from('user_auth_identities')
      .where('user_id', user.id)
      .select('id')
    assert.lengthOf(identityRows, 0)
  })

  test('is idempotent — second call does not re-anonymize', async ({ assert }) => {
    const user = await UserFactory.apply('disabled').create()
    user.disabledAt = DateTime.utc().minus({ days: 30 })
    await user.save()

    const first = await service.anonymizeUser(user.id)
    assert.isTrue(first)

    await user.refresh()
    const firstAnonymizedAt = user.anonymizedAt

    const second = await service.anonymizeUser(user.id)
    assert.isFalse(second)

    await user.refresh()
    assert.equal(user.anonymizedAt?.toISO(), firstAnonymizedAt?.toISO())
  })

  test('batch run respects grace period', async ({ assert }) => {
    const fresh = await UserFactory.apply('disabled').create()
    fresh.disabledAt = DateTime.utc().minus({ days: 2 })
    await fresh.save()

    const stale = await UserFactory.apply('disabled').create()
    stale.disabledAt = DateTime.utc().minus({ days: 10 })
    await stale.save()

    const active = await UserFactory.create()

    const summary = await service.anonymizeDisabledUsers(7)
    assert.equal(summary.anonymized, 1)
    assert.equal(summary.failed, 0)

    await fresh.refresh()
    await stale.refresh()
    await active.refresh()
    assert.isNull(fresh.anonymizedAt, 'fresh disabled user must remain inside grace')
    assert.isNotNull(stale.anonymizedAt, 'stale disabled user must be anonymized')
    assert.isNull(active.anonymizedAt, 'active user must never be touched')
  })

  test('after anonymization OIDC lookup by both provider id and email returns not_found', async ({
    assert,
  }) => {
    const user = await UserFactory.apply('disabled')
      .merge({ email: 'jan.novak@example.com' })
      .create()
    user.disabledAt = DateTime.utc().minus({ days: 30 })
    await user.save()

    await authIdentity.ensureLinkedIdentity({
      userId: user.id,
      provider: 'microsoft',
      providerUserId: 'entra-stable-oid',
      providerEmail: 'jan.novak@example.com',
      providerEmailVerified: true,
    })

    await service.anonymizeUser(user.id)

    const byProvider = await authIdentity.resolveForLogin({
      provider: 'microsoft',
      providerUserId: 'entra-stable-oid',
      email: 'jan.novak@example.com',
    })
    assert.equal(byProvider.kind, 'not_found')

    const byEmail = await authIdentity.resolveForLogin({
      provider: 'microsoft',
      providerUserId: null,
      email: 'jan.novak@example.com',
    })
    assert.equal(byEmail.kind, 'not_found')
  })

  test('writes user.anonymized audit log entry', async ({ assert }) => {
    const user = await UserFactory.apply('disabled').create()
    user.disabledAt = DateTime.utc().minus({ days: 30 })
    await user.save()

    await service.anonymizeUser(user.id)

    const entry = await db
      .from('audit_logs')
      .where('user_id', user.id)
      .where('action', 'user.anonymized')
      .first()
    assert.isNotNull(entry)
    assert.equal(Number(entry.entity_id), user.id)
  })
})
