import vine from '@vinejs/vine'

export const createMusicTrackValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    accessLevel: vine.enum(['public', 'premium'] as const).optional(),
    file: vine.file({ size: '20mb', extnames: ['mp3', 'ogg', 'wav', 'm4a'] }),
  })
)

export const updateMusicTrackValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    accessLevel: vine.enum(['public', 'premium'] as const).optional(),
    isDisabled: vine.boolean().optional(),
  })
)
