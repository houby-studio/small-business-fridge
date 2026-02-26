import type { HttpContext } from '@adonisjs/core/http'
import MusicService from '#services/music_service'
import { createMusicTrackValidator, updateMusicTrackValidator } from '#validators/music_track'
import AuditService from '#services/audit_service'
import MusicTrack from '#models/music_track'

export default class MusicTracksController {
  async index({ inertia }: HttpContext) {
    const service = new MusicService()
    const tracks = await service.getTracks()

    return inertia.render('admin/music/index', {
      tracks: tracks.map((track) => ({
        id: track.id,
        name: track.name,
        filePath: track.filePath,
        mimeType: track.mimeType,
        accessLevel: track.accessLevel,
        isDisabled: track.isDisabled,
      })),
    })
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(createMusicTrackValidator)

    const service = new MusicService()
    const track = await service.createTrack({
      name: data.name,
      file: data.file,
      accessLevel: data.accessLevel,
      uploadedByUserId: auth.user?.id,
    })

    await AuditService.log(auth.user!.id, 'music.created', 'music', track.id, null, {
      name: track.name,
      accessLevel: track.accessLevel,
      isDisabled: track.isDisabled,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.music_created', { name: track.name }),
    })

    return response.redirect('/admin/music')
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateMusicTrackValidator)

    const trackBefore = await MusicTrack.findOrFail(Number(params.id))
    const before = {
      name: trackBefore.name,
      accessLevel: trackBefore.accessLevel,
      isDisabled: trackBefore.isDisabled,
    }

    const service = new MusicService()
    const track = await service.updateTrack(Number(params.id), data)

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of ['name', 'accessLevel', 'isDisabled'] as const) {
      if (data[key] !== undefined && before[key] !== track[key]) {
        changes[key] = { from: before[key], to: track[key] }
      }
    }

    if (Object.keys(changes).length > 0) {
      await AuditService.log(auth.user!.id, 'music.updated', 'music', track.id, null, changes)
    }

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.music_updated', { name: track.name }),
    })

    return response.redirect('/admin/music')
  }

  async destroy({ params, response, session, i18n, auth }: HttpContext) {
    const service = new MusicService()
    const track = await service.deleteTrack(Number(params.id))

    await AuditService.log(auth.user!.id, 'music.deleted', 'music', track.id, null, {
      name: track.name,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.music_deleted', { name: track.name }),
    })

    return response.redirect('/admin/music')
  }
}
