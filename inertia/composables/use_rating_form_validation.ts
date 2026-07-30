import { computed, type Ref } from 'vue'

// Mirrors app/validators/rating.ts. Update both sides together.
export const RATING_COMMENT_MAX_LENGTH = 2000
export const RATING_STARS_MIN = 1
export const RATING_STARS_MAX = 5
export const RATING_VISIBILITY_VALUES = ['public', 'private'] as const
export type RatingVisibility = (typeof RATING_VISIBILITY_VALUES)[number]

export interface RatingFormState {
  stars: number
  comment: string
  visibility: RatingVisibility
}

/**
 * Reactive client-side validation for the product-rating form.
 * Mirrors backend constraints in app/validators/rating.ts.
 */
export function useRatingFormValidation(form: Ref<RatingFormState>) {
  const starsError = computed(() => {
    const v = form.value.stars
    if (!Number.isInteger(v)) return 'Hvězdičky musí být celé číslo.'
    if (v < RATING_STARS_MIN || v > RATING_STARS_MAX) {
      return `Hvězdičky musí být mezi ${RATING_STARS_MIN} a ${RATING_STARS_MAX}.`
    }
    return null
  })

  const commentError = computed(() => {
    const c = (form.value.comment ?? '').trim()
    if (c.length > RATING_COMMENT_MAX_LENGTH) {
      return `Komentář může mít nejvýše ${RATING_COMMENT_MAX_LENGTH} znaků.`
    }
    return null
  })

  const visibilityError = computed(() => {
    if (!RATING_VISIBILITY_VALUES.includes(form.value.visibility)) {
      return 'Neplatná viditelnost.'
    }
    return null
  })

  const isValid = computed(() => !starsError.value && !commentError.value && !visibilityError.value)

  return { starsError, commentError, visibilityError, isValid }
}
