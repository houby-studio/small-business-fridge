import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import MusicTrack from '#models/music_track'
import MusicService from '#services/music_service'

const musicService = new MusicService()

test.group('MusicService', (group) => {
  group.each.setup(async () => {
    await MusicTrack.query().delete()
    const { default: User } = await import('#models/user')
    await User.query().delete()
  })

  test('getEligibleTracks returns only public tracks for non-premium user', async ({ assert }) => {
    const customer = await UserFactory.create()

    await MusicTrack.create({
      name: 'Public Track',
      filePath: '/uploads/music/public.mp3',
      mimeType: 'audio/mpeg',
      accessLevel: 'public',
      isDisabled: false,
    })

    await MusicTrack.create({
      name: 'Premium Track',
      filePath: '/uploads/music/premium.mp3',
      mimeType: 'audio/mpeg',
      accessLevel: 'premium',
      isDisabled: false,
    })

    const tracks = await musicService.getEligibleTracks(customer.id)

    assert.lengthOf(tracks, 1)
    assert.equal(tracks[0].name, 'Public Track')
  })

  test('getEligibleTracks returns premium tracks for premium user', async ({ assert }) => {
    const customer = await UserFactory.create()
    customer.isPremium = true
    await customer.save()

    await MusicTrack.create({
      name: 'Public Track',
      filePath: '/uploads/music/public.mp3',
      mimeType: 'audio/mpeg',
      accessLevel: 'public',
      isDisabled: false,
    })

    await MusicTrack.create({
      name: 'Premium Track',
      filePath: '/uploads/music/premium.mp3',
      mimeType: 'audio/mpeg',
      accessLevel: 'premium',
      isDisabled: false,
    })

    const tracks = await musicService.getEligibleTracks(customer.id)
    const names = tracks.map((track) => track.name)

    assert.include(names, 'Public Track')
    assert.include(names, 'Premium Track')
  })

  test('getEligibleTracks excludes disabled tracks', async ({ assert }) => {
    const customer = await UserFactory.create()

    await MusicTrack.create({
      name: 'Disabled Track',
      filePath: '/uploads/music/disabled.mp3',
      mimeType: 'audio/mpeg',
      accessLevel: 'public',
      isDisabled: true,
    })

    const tracks = await musicService.getEligibleTracks(customer.id)
    assert.lengthOf(tracks, 0)
  })
})
