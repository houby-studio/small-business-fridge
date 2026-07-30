import vine from '@vinejs/vine'

export const RATING_COMMENT_MAX_LENGTH = 2000
export const RATING_STARS_MIN = 1
export const RATING_STARS_MAX = 5
export const RATING_VISIBILITY_VALUES = ['public', 'private'] as const

export const createOrUpdateRatingValidator = vine.compile(
  vine.object({
    productId: vine.number().positive().optional(),
    stars: vine.number().min(RATING_STARS_MIN).max(RATING_STARS_MAX),
    comment: vine.string().trim().maxLength(RATING_COMMENT_MAX_LENGTH).optional().nullable(),
    visibility: vine.enum(RATING_VISIBILITY_VALUES),
  })
)
