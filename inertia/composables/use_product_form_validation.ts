import { computed, type Ref } from 'vue'

interface UseProductFormValidationOptions {
  requireImage: boolean
}

interface ProductFormValue {
  displayName: string
  description: string
  categoryId: number | null
  barcode: string
  hasImage: boolean
}

export function useProductFormValidation(
  form: Ref<ProductFormValue>,
  options: UseProductFormValidationOptions
) {
  const displayNameMissing = computed(() => form.value.displayName.trim().length === 0)
  const displayNameTooLong = computed(() => form.value.displayName.trim().length > 255)
  const descriptionMissing = computed(() => form.value.description.trim().length === 0)
  const descriptionTooLong = computed(() => form.value.description.trim().length > 1000)
  const categoryMissing = computed(() => form.value.categoryId === null)
  const barcodeTooLong = computed(() => form.value.barcode.trim().length > 100)
  const imageMissing = computed(() => options.requireImage && !form.value.hasImage)

  const hasBlockingErrors = computed(
    () =>
      displayNameMissing.value ||
      displayNameTooLong.value ||
      descriptionMissing.value ||
      descriptionTooLong.value ||
      categoryMissing.value ||
      barcodeTooLong.value ||
      imageMissing.value
  )

  return {
    displayNameMissing,
    displayNameTooLong,
    descriptionMissing,
    descriptionTooLong,
    categoryMissing,
    barcodeTooLong,
    imageMissing,
    hasBlockingErrors,
  }
}
