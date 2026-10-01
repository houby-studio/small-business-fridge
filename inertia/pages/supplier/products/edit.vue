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
  imageCapabilities: ProductImageCapabilities
  aiSuggestions: boolean
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
const imageBusy = ref(false)
const suggestions = useProductSuggestions(form, props.aiSuggestions)
const { hints, describing, descriptionError } = suggestions
const picker = ref<InstanceType<typeof ProductImagePicker> | null>(null)
const nameInput = ref<any>(null)
const descriptionInput = ref<any>(null)
const categorySelect = ref<any>(null)

/** Only an uploaded image can be processed again; the legacy default picture cannot. */
const storedImageProductId = computed(() =>
  props.product.imagePath?.startsWith('/uploads/products/') ? props.product.id : null
)

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
const submitDisabled = computed(
  () => form.processing || imageBusy.value || validation.hasBlockingErrors.value
)

function fieldError(field: keyof typeof touched) {
  const serverError = form.errors[field as keyof typeof form.errors]
  if (serverError) return serverError
  return touched[field] ? clientErrors.value[field] : ''
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
  if (submitDisabled.value) return

  // Must be a real PUT — AdonisJS only honours `_method` spoofing from the query
  // string, never from the request body, and the body is parsed after routing.
  //
  // allergenIds goes as JSON because an empty array has no FormData representation: the
  // key would simply be absent, which the server reads as "not submitted" rather than
  // "all allergens removed", making it impossible to clear them.
  form
    .transform((data) => ({
      ...data,
      allergenIds: JSON.stringify(data.allergenIds),
    }))
    .put(`/supplier/products/${props.product.id}`, {
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

useInitialFocus(() => document.getElementById('edit-product-name'))
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
        text
        @click="goBack"
      />
    </div>

    <form class="grid items-start gap-6 lg:grid-cols-3" @submit.prevent="submit">
      <Card class="lg:sticky lg:top-20 lg:col-span-1">
        <template #content>
          <label class="mb-3 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('supplier.products_image_label')
          }}</label>
          <ProductImagePicker
            ref="picker"
            :capabilities="imageCapabilities"
            :storedImageUrl="product.imagePath"
            :storedImageProductId="storedImageProductId"
            :alt="previewTitle"
            @update:file="form.image = $event"
            @busy="imageBusy = $event"
          />
        </template>
      </Card>

      <Card class="lg:col-span-2">
        <template #content>
          <div class="flex flex-col gap-5">
            <div class="text-sm text-gray-500 dark:text-zinc-400">
              {{ t('supplier.products_keypad_id') }}: <strong>{{ product.keypadId }}</strong>
            </div>

            <div>
              <label
                for="edit-product-barcode"
                class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
                >{{ t('supplier.products_barcode_label') }}</label
              >
              <ProductBarcodeField
                v-model="form.barcode"
                inputId="edit-product-barcode"
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
              <label
                for="edit-product-name"
                class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
                >{{ t('supplier.products_name_label') }} *</label
              >
              <InputText
                ref="nameInput"
                id="edit-product-name"
                v-model="form.displayName"
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
              <div class="mb-1 flex items-center justify-between gap-2">
                <label
                  for="edit-product-description"
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
                  inputId="edit-product-category"
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
                  inputId="edit-product-allergens"
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

            <div class="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
              <Button
                type="submit"
                :label="
                  imageBusy
                    ? t('supplier.products_waiting_for_image')
                    : t('supplier.products_edit_submit')
                "
                icon="pi pi-check"
                class="w-full sm:w-auto"
                :loading="form.processing"
                :disabled="submitDisabled"
              />
              <small
                v-if="form.image && !imageBusy"
                class="text-gray-500 dark:text-zinc-400"
                data-testid="product-form-image-replaced"
                >{{ t('supplier.products_image_will_replace') }}</small
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
