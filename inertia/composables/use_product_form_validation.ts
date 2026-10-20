import { computed, type Ref } from 'vue'

// Mirrors app/validators/product.ts — the photo and the description are optional there.
interface ProductFormValue {
  displayName: string
  description: string
  categoryId: number | null
  barcode: string
}

export function useProductFormValidation(form: Ref<ProductFormValue>) {
  const displayNameMissing = computed(() => form.value.displayName.trim().length === 0)
  const displayNameTooLong = computed(() => form.value.displayName.trim().length > 255)
  const descriptionTooLong = computed(() => form.value.description.trim().length > 1000)
  const categoryMissing = computed(() => form.value.categoryId === null)
  const barcodeTooLong = computed(() => form.value.barcode.trim().length > 100)

  const hasBlockingErrors = computed(
    () =>
      displayNameMissing.value ||
      displayNameTooLong.value ||
      descriptionTooLong.value ||
      categoryMissing.value ||
      barcodeTooLong.value
  )

  return {
    displayNameMissing,
    displayNameTooLong,
    descriptionTooLong,
    categoryMissing,
    barcodeTooLong,
    hasBlockingErrors,
  }
}
