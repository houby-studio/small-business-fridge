<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Head, router, useForm } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import FileUpload from 'primevue/fileupload'
import Button from 'primevue/button'
import Card from 'primevue/card'
import { useI18n } from '~/composables/use_i18n'
import { useProductFormValidation } from '~/composables/use_product_form_validation'

interface CategoryOption {
  id: number
  name: string
  color: string
}

interface AllergenOption {
  id: number
  name: string
}

interface ProductData {
  id: number
  keypadId: number
  displayName: string
  description: string | null
  imagePath: string | null
  barcode: string | null
  categoryId: number
  allergenIds: number[]
}

const props = defineProps<{
  product: ProductData
  categories: CategoryOption[]
  allergens: AllergenOption[]
}>()
const { t } = useI18n()

const form = useForm({
  displayName: props.product.displayName,
  description: props.product.description ?? '',
  categoryId: props.product.categoryId,
  barcode: props.product.barcode ?? '',
  allergenIds: [...props.product.allergenIds],
  image: null as File | null,
})
const imagePreviewUrl = ref<string | null>(null)
const nameInput = ref<any>(null)
const descriptionInput = ref<any>(null)
const categorySelect = ref<any>(null)

const displayedImageSrc = computed(() => imagePreviewUrl.value || props.product.imagePath || null)
const previewTitle = computed(() => form.displayName || props.product.displayName)
const validation = useProductFormValidation(
  computed(() => ({
    displayName: form.displayName,
    description: form.description,
    categoryId: form.categoryId,
    barcode: form.barcode,
    hasImage: true,
  })),
  { requireImage: false }
)
const clientErrors = computed(() => ({
  displayName: validation.displayNameMissing.value
    ? t('supplier.products_validation_name_required')
    : validation.displayNameTooLong.value
      ? t('supplier.products_validation_name_max')
      : '',
  description: validation.descriptionMissing.value
    ? t('supplier.products_validation_description_required')
    : validation.descriptionTooLong.value
      ? t('supplier.products_validation_description_max')
      : '',
  categoryId: validation.categoryMissing.value
    ? t('supplier.products_validation_category_required')
    : '',
  barcode: validation.barcodeTooLong.value ? t('supplier.products_validation_barcode_max') : '',
}))
const submitDisabled = computed(() => form.processing || validation.hasBlockingErrors.value)

function fieldError(field: keyof typeof form.errors | keyof typeof clientErrors.value) {
  const serverError = form.errors[field as keyof typeof form.errors]
  if (serverError) return serverError
  return clientErrors.value[field as keyof typeof clientErrors.value]
}

function resetPreviewUrl() {
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value)
    imagePreviewUrl.value = null
  }
}

function onImageSelect(event: any) {
  form.image = event.files[0] ?? null
  resetPreviewUrl()
  if (form.image) {
    imagePreviewUrl.value = URL.createObjectURL(form.image)
  }
}

function getRootElement(target: any): HTMLElement | null {
  const candidate = target?.$el ?? target
  return candidate instanceof HTMLElement ? candidate : null
}

function focusTextControl(target: any) {
  const root = getRootElement(target)
  if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
    root.focus()
    return
  }
  const field = root?.querySelector('input, textarea') as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
  field?.focus()
}

function focusSelectControl(target: any) {
  const instance = target
  const root = getRootElement(instance)
  const trigger = root?.querySelector('[role="combobox"]') as HTMLElement | null
  trigger?.focus()
}

function onNameEnter() {
  focusTextControl(descriptionInput.value)
}

function onDescriptionEnter() {
  focusSelectControl(categorySelect.value)
}

function submit() {
  if (submitDisabled.value) return

  form
    .transform((data) => ({
      ...data,
      _method: 'PUT',
      allergenIds: JSON.stringify(data.allergenIds),
    }))
    .post(`/supplier/products/${props.product.id}`, {
      forceFormData: true,
      preserveScroll: true,
      onFinish: () => {
        form.transform((data) => data)
      },
    })
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  router.get('/supplier/products')
}

onUnmounted(() => {
  resetPreviewUrl()
})

onMounted(() => {
  nextTick(() => {
    const retries = [0, 100, 300]
    retries.forEach((delay) => {
      window.setTimeout(() => {
        focusTextControl(nameInput.value)
      }, delay)
    })
  })
})
</script>

<template>
  <AppLayout>
    <Head :title="`${t('supplier.products_edit_title')}: ${product.displayName}`" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.products_edit_heading') }}
      </h1>
      <Button
        :label="t('common.back')"
        icon="pi pi-arrow-left"
        size="small"
        severity="secondary"
        @click="goBack"
      />
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-3">
      <Card class="order-first lg:order-none lg:col-span-1">
        <template #content>
          <h2 class="mb-3 text-sm font-medium text-gray-700 dark:text-zinc-300">
            {{ t('supplier.products_image_label') }}
          </h2>
          <div
            class="flex h-56 w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/60"
          >
            <img
              v-if="displayedImageSrc"
              :src="displayedImageSrc"
              :alt="previewTitle"
              class="h-full w-full rounded object-contain"
            />
            <span v-else class="pi pi-image text-5xl text-gray-300 dark:text-zinc-600" />
          </div>
        </template>
      </Card>

      <Card class="lg:col-span-2">
        <template #content>
          <form @submit.prevent="submit" class="flex flex-col gap-5">
            <div class="text-sm text-gray-500 dark:text-zinc-400">
              {{ t('supplier.products_keypad_id') }}: <strong>{{ product.keypadId }}</strong>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                t('supplier.products_name_label')
              }}</label>
              <InputText
                ref="nameInput"
                id="edit-product-name"
                v-model="form.displayName"
                autofocus
                class="w-full"
                :placeholder="t('supplier.products_name_placeholder')"
                :invalid="!!fieldError('displayName')"
                @keydown.enter.prevent="onNameEnter"
              />
              <small v-if="fieldError('displayName')" class="text-red-600 dark:text-red-400">{{
                fieldError('displayName')
              }}</small>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                t('supplier.products_description_label')
              }}</label>
              <Textarea
                ref="descriptionInput"
                id="edit-product-description"
                v-model="form.description"
                rows="3"
                class="w-full"
                :placeholder="t('supplier.products_description_placeholder')"
                :invalid="!!fieldError('description')"
                @keydown.enter.prevent="onDescriptionEnter"
              />
              <small v-if="fieldError('description')" class="text-red-600 dark:text-red-400">{{
                fieldError('description')
              }}</small>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                t('supplier.products_category_label')
              }}</label>
              <Select
                ref="categorySelect"
                inputId="edit-product-category"
                v-model="form.categoryId"
                :options="categories"
                optionLabel="name"
                optionValue="id"
                :placeholder="t('supplier.products_category_label')"
                class="w-full"
                :invalid="!!fieldError('categoryId')"
              />
              <small v-if="fieldError('categoryId')" class="text-red-600 dark:text-red-400">{{
                fieldError('categoryId')
              }}</small>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                t('supplier.products_barcode_label')
              }}</label>
              <InputText
                id="edit-product-barcode"
                v-model="form.barcode"
                class="w-full"
                :placeholder="t('supplier.products_barcode_placeholder')"
                :invalid="!!fieldError('barcode')"
              />
              <small v-if="fieldError('barcode')" class="text-red-600 dark:text-red-400">{{
                fieldError('barcode')
              }}</small>
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                t('supplier.products_allergens_label')
              }}</label>
              <MultiSelect
                inputId="edit-product-allergens"
                v-model="form.allergenIds"
                :options="allergens"
                optionLabel="name"
                optionValue="id"
                :placeholder="t('supplier.products_allergens_label')"
                :emptyMessage="t('supplier.products_no_available_options')"
                :emptyFilterMessage="t('supplier.products_no_available_options')"
                class="w-full"
              />
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                t('supplier.products_image_label')
              }}</label>
              <FileUpload
                mode="basic"
                accept="image/*"
                :maxFileSize="5000000"
                :chooseLabel="t('supplier.products_image_upload')"
                @select="onImageSelect"
                :auto="false"
              />
            </div>

            <div class="pt-2">
              <Button
                type="submit"
                :label="t('supplier.products_edit_submit')"
                icon="pi pi-check"
                :loading="form.processing"
                :disabled="submitDisabled"
              />
            </div>
          </form>
        </template>
      </Card>
    </div>
  </AppLayout>
</template>
