import type { MultipartFile } from '@adonisjs/core/bodyparser'
import { cuid } from '@adonisjs/core/helpers'
import app from '@adonisjs/core/services/app'
import MusicTrack from '#models/music_track'
import User from '#models/user'
import { mkdir, rm } from 'node:fs/promises'

export default class MusicService {
  async getTracks() {
    return MusicTrack.query().orderBy('name', 'asc').orderBy('id', 'asc')
  }

  async createTrack(data: {
    name: string
    file: MultipartFile
    accessLevel?: 'public' | 'premium'
    uploadedByUserId?: number | null
  }) {
    const filePath = await this.saveAudio(data.file)

    return MusicTrack.create({
      name: data.name,
      filePath,
      mimeType: this.toMimeType(data.file),
      accessLevel: data.accessLevel ?? 'public',
      isDisabled: false,
      uploadedByUserId: data.uploadedByUserId ?? null,
    })
  }

  async updateTrack(
    trackId: number,
    data: { name?: string; accessLevel?: 'public' | 'premium'; isDisabled?: boolean }
  ) {
    const track = await MusicTrack.findOrFail(trackId)

    if (data.name !== undefined) track.name = data.name
    if (data.accessLevel !== undefined) track.accessLevel = data.accessLevel
    if (data.isDisabled !== undefined) track.isDisabled = data.isDisabled

    await track.save()
    return track
  }

  async deleteTrack(trackId: number) {
    const track = await MusicTrack.findOrFail(trackId)

    // Best-effort cleanup: keep deletion working even if the file is already missing.
    try {
      const relativePath = track.filePath.replace(/^\/+/, '')
      const absolutePath = app.makePath('storage', relativePath)
      await rm(absolutePath, { force: true })
    } catch {
      // Ignore file removal errors.
    }

    await track.delete()
    return track
  }

  async getEligibleTracks(userId: number) {
    const user = await User.find(userId)
    const isPremium = user?.isPremium === true

    const query = MusicTrack.query()
      .where('isDisabled', false)
      .orderBy('name', 'asc')
      .orderBy('id', 'asc')

    if (!isPremium) {
      query.where('accessLevel', 'public')
    }

    const tracks = await query

    return tracks.map((track) => ({
      id: track.id,
      name: track.name,
      filePath: track.filePath,
      accessLevel: track.accessLevel,
    }))
  }

  private toMimeType(file: MultipartFile): string {
    if (file.type && file.subtype) {
      return `${file.type}/${file.subtype}`
    }

    const ext = (file.extname ?? '').toLowerCase()
    if (ext === 'mp3') return 'audio/mpeg'
    if (ext === 'ogg') return 'audio/ogg'
    if (ext === 'wav') return 'audio/wav'
    if (ext === 'm4a') return 'audio/mp4'
    return 'application/octet-stream'
  }

  private async saveAudio(file: MultipartFile): Promise<string> {
    const fileName = `${cuid()}.${file.extname}`
    const targetDir = app.makePath('storage/uploads/music')
    await mkdir(targetDir, { recursive: true })
    await file.move(targetDir, { name: fileName })
    return `/uploads/music/${fileName}`
  }
}
