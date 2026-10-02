<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Head, router, useForm } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import Button from 'primevue/button'
import Card from 'primevue/card'
import { useI18n } from '~/composables/use_i18n'
import { useProductFormValidation } from '~/composables/use_product_form_validation'
import { useInitialFocus } from '~/composables/use_initial_focus'
import ProductImagePicker, {
  type ProductImageCapabilities,
} from '~/components/supplier/ProductImagePicker.vue'
import ProductBarcodeField from '~/components/supplier/ProductBarcodeField.vue'
import ProductOffContribution from '~/components/supplier/ProductOffContribution.vue'
import { useProductSuggestions } from '~/composables/use_product_suggestions'

interface CategoryOption {
  id: number
  name: string
  color: string
}

interface AllergenOption {
  id: number
  name: string
}

const props = defineProps<{
  categories: CategoryOption[]
  allergens: AllergenOption[]
  imageCapabilities: ProductImageCapabilities
  aiSuggestions: boolean
}>()
const { t } = useI18n()

const form = useForm({
  displayName: '',
  description: '',
  categoryId: null as number | null,
  barcode: '',
  allergenIds: [] as number[],
  image: null as File | null,
  offContribute: false,
  offOriginal: null as File | null,
  offBackground: 'auto',
})
const imageBusy = ref(false)

function onOriginal(original: { file: File; background: string } | null) {
  form.offOriginal = original?.file ?? null
  form.offBackground = original?.background ?? 'auto'
}

/** The Open Food Facts fields only travel with the consent, the photo only when there is one. */
function offFields<
  T extends { offContribute: boolean; offOriginal: File | null; offBackground: string },
>(data: T) {
  const { offOriginal, offBackground, ...rest } = data
  return data.offContribute && offOriginal ? { ...rest, offOriginal, offBackground } : rest
}
const suggestions = useProductSuggestions(form, props.aiSuggestions)
const { hints, describing, descriptionError } = suggestions
const picker = ref<InstanceType<typeof ProductImagePicker> | null>(null)
const nameInput = ref<any>(null)
const descriptionInput = ref<any>(null)
const categorySelect = ref<any>(null)

// Inline errors only for fields the supplier has already touched — an untouched form is
// not wrong yet. What is still missing is summed up next to the disabled submit instead.
const touched = reactive({
  displayName: false,
  description: false,
  categoryId: false,
  barcode: false,
})
watch(
  () => [form.displayName, form.description, form.categoryId, form.barcode] as const,
  ([name, description, category, barcode], previous) => {
    if (name !== previous[0]) touched.displayName = true
    if (description !== previous[1]) touched.description = true
    if (category !== previous[2]) touched.categoryId = true
    if (barcode !== previous[3]) touched.barcode = true
  }
)

const previewTitle = computed(() => form.displayName || t('supplier.products_name_label'))
const validation = useProductFormValidation(
  computed(() => ({
    displayName: form.displayName,
    description: form.description,
    categoryId: form.categoryId,
    barcode: form.barcode,
    hasImage: !!form.image,
  })),
  { requireImage: true }
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
const missing = computed(() =>
  [
    validation.displayNameMissing.value && t('supplier.products_name_label'),
    validation.descriptionMissing.value && t('supplier.products_description_label'),
    validation.categoryMissing.value && t('supplier.products_category_label'),
    validation.imageMissing.value && t('supplier.products_image_label'),
  ].filter(Boolean)
)
const submitDisabled = computed(
  () => form.processing || imageBusy.value || validation.hasBlockingErrors.value
)

function fieldError(field: keyof typeof touched) {
  const serverError = form.errors[field as keyof typeof form.errors]
  if (serverError) return serverError
  return touched[field] ? clientErrors.value[field] : ''
}

function onImageProcessed(file: File | null) {
  form.image = file
  if (file) form.clearErrors('image')
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
  const root = getRootElement(target)
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
  if (submitDisabled.value) {
    return
  }

  // allergenIds goes as JSON for the same reason as in edit.vue: FormData cannot express
  // an empty array, and this keeps both forms sending the exact same shape. Without the
  // transform, Inertia's indexed FormData keys used to be dropped and every allergen
  // picked here was silently lost.
  form
    .transform((data) => ({
      ...offFields(data),
      allergenIds: JSON.stringify(data.allergenIds),
    }))
    .post('/supplier/products', {
      forceFormData: true,
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

// The supplier usually has the product in hand: start at the barcode (a scanner types it
// and presses Enter, which looks it up and moves on to the name).
useInitialFocus(() => document.getElementById('product-barcode'))
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.products_new_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.products_new_heading') }}
      </h1>
      <Button
        :label="t('common.back')"
        icon="pi pi-arrow-left"
        size="small"
        severity="secondary"
        text
        @click="goBack"
      />
    </div>

    <form class="grid items-start gap-6 lg:grid-cols-3" @submit.prevent="submit">
      <Card class="lg:sticky lg:top-20 lg:col-span-1">
        <template #content>
          <label class="mb-3 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('supplier.products_image_label') }} *</label
          >
          <ProductImagePicker
            ref="picker"
            :capabilities="imageCapabilities"
            :alt="previewTitle"
            @update:file="onImageProcessed"
            @busy="imageBusy = $event"
            @update:original="onOriginal"
          />
        </template>
      </Card>

      <Card class="lg:col-span-2">
        <template #content>
          <div class="flex flex-col gap-5">
            <div>
              <label
                for="product-barcode"
                class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
                >{{ t('supplier.products_barcode_label') }}</label
              >
              <ProductBarcodeField
                v-model="form.barcode"
                inputId="product-barcode"
                :lookupEnabled="imageCapabilities.openFoodFacts"
                :placeholder="t('supplier.products_barcode_placeholder')"
                :invalid="!!fieldError('barcode')"
                :currentName="form.displayName"
                @pickImage="picker?.useUrl($event)"
                @found="suggestions.onFound"
                @useName="form.displayName = $event"
                @enter="focusTextControl(nameInput)"
              />
              <small v-if="fieldError('barcode')" class="text-red-600 dark:text-red-400">{{
                fieldError('barcode')
              }}</small>
            </div>

            <div>
              <label for="product-name" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
                >{{ t('supplier.products_name_label') }} *</label
              >
              <InputText
                ref="nameInput"
                id="product-name"
                v-model="form.displayName"
                :placeholder="t('supplier.products_name_placeholder')"
                class="w-full"
                :invalid="!!fieldError('displayName')"
                @keydown.enter.prevent="onNameEnter"
              />
              <small v-if="fieldError('displayName')" class="text-red-600 dark:text-red-400">{{
                fieldError('displayName')
              }}</small>
            </div>

            <div>
              <div class="mb-1 flex items-center justify-between gap-2">
                <label
                  for="product-description"
                  class="block text-sm text-gray-700 dark:text-zinc-300"
                  >{{ t('supplier.products_description_label') }} *</label
                >
                <Button
                  v-if="aiSuggestions"
                  :label="t('supplier.products_suggest')"
                  icon="pi pi-sparkles"
                  severity="secondary"
                  text
                  size="small"
                  :loading="describing"
                  :disabled="describing || !form.displayName.trim()"
                  data-testid="product-suggest-description"
                  @click="suggestions.suggestDescription"
                />
              </div>
              <Textarea
                ref="descriptionInput"
                id="product-description"
                v-model="form.description"
                rows="3"
                :placeholder="t('supplier.products_description_placeholder')"
                class="w-full"
                :invalid="!!fieldError('description')"
                @keydown.enter.prevent="onDescriptionEnter"
              />
              <small v-if="fieldError('description')" class="text-red-600 dark:text-red-400">{{
                fieldError('description')
              }}</small>
              <small v-else-if="descriptionError" class="text-red-600 dark:text-red-400">{{
                descriptionError
              }}</small>
              <small v-else-if="hints.description" class="text-gray-500 dark:text-zinc-400"
                ><span class="pi pi-sparkles mr-1 !text-xs" />{{
                  t('supplier.products_hint_ai_description')
                }}</small
              >
            </div>

            <div class="grid gap-5 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
                  >{{ t('supplier.products_category_label') }} *</label
                >
                <Select
                  ref="categorySelect"
                  inputId="product-category"
                  v-model="form.categoryId"
                  :options="categories"
                  optionLabel="name"
                  optionValue="id"
                  :placeholder="t('supplier.products_category_placeholder')"
                  class="w-full"
                  :invalid="!!fieldError('categoryId')"
                />
                <small v-if="fieldError('categoryId')" class="text-red-600 dark:text-red-400">{{
                  fieldError('categoryId')
                }}</small>
                <small v-else-if="hints.category" class="text-gray-500 dark:text-zinc-400"
                  ><span class="pi pi-sparkles mr-1 !text-xs" />{{
                    t('supplier.products_hint_ai_category')
                  }}</small
                >
              </div>

              <div>
                <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
                  t('supplier.products_allergens_label')
                }}</label>
                <MultiSelect
                  inputId="product-allergens"
                  v-model="form.allergenIds"
                  :options="allergens"
                  optionLabel="name"
                  optionValue="id"
                  :placeholder="t('supplier.products_allergens_none')"
                  :emptyMessage="t('supplier.products_no_available_options')"
                  :emptyFilterMessage="t('supplier.products_no_available_options')"
                  class="w-full"
                />
                <small v-if="hints.allergens" class="text-gray-500 dark:text-zinc-400"
                  ><span class="pi pi-database mr-1 !text-xs" />{{
                    t('supplier.products_hint_off_allergens')
                  }}</small
                >
              </div>
            </div>

            <ProductOffContribution
              v-model="form.offContribute"
              :enabled="imageCapabilities.openFoodFactsContribute"
              :barcode="form.barcode"
              :hasOwnPhoto="!!form.offOriginal"
            />

            <div class="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
              <Button
                type="submit"
                :label="
                  imageBusy
                    ? t('supplier.products_waiting_for_image')
                    : t('supplier.products_create_submit')
                "
                icon="pi pi-check"
                class="w-full sm:w-auto"
                :loading="form.processing"
                :disabled="submitDisabled"
              />
              <small
                v-if="missing.length && !imageBusy"
                class="text-gray-500 dark:text-zinc-400"
                data-testid="product-form-missing"
                >{{ t('supplier.products_missing', { fields: missing.join(', ') }) }}</small
              >
              <small v-if="form.errors.image" class="text-red-600 dark:text-red-400">{{
                form.errors.image
              }}</small>
            </div>
          </div>
        </template>
      </Card>
    </form>
  </AppLayout>
</template>
