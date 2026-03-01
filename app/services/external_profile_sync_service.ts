import type User from '#models/user'

type ExternalLoginProfile = {
  phone: string | null
}

export default class ExternalProfileSyncService {
  async syncAfterExternalLogin(user: User, profile: ExternalLoginProfile): Promise<void> {
    let dirty = false

    // Keep account identity fields user-managed and stable across providers.
    // Only backfill optional data that is currently empty.
    if (profile.phone && !user.phone) {
      user.phone = profile.phone
      dirty = true
    }

    if (dirty) {
      await user.save()
    }
  }
}
