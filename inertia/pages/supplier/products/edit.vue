<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import FileUpload from 'primevue/fileupload'
import Button from 'primevue/button'
import Card from 'primevue/card'
import { useI18n } from '~/composables/use_i18n'

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

const form = ref({
  displayName: props.product.displayName,
  description: props.product.description ?? '',
  categoryId: props.product.categoryId,
  barcode: props.product.barcode ?? '',
  allergenIds: [...props.product.allergenIds],
})
const imageFile = ref<File | null>(null)
const submitting = ref(false)
const imagePreviewUrl = ref<string | null>(null)
const nameInput = ref<any>(null)
const descriptionInput = ref<any>(null)
const categorySelect = ref<any>(null)

const displayedImageSrc = computed(() => imagePreviewUrl.value || props.product.imagePath || null)
const previewTitle = computed(() => form.value.displayName || props.product.displayName)

function resetPreviewUrl() {
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value)
    imagePreviewUrl.value = null
  }
}

function onImageSelect(event: any) {
  imageFile.value = event.files[0] ?? null
  resetPreviewUrl()
  if (imageFile.value) {
    imagePreviewUrl.value = URL.createObjectURL(imageFile.value)
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
  if (!form.value.displayName || !form.value.categoryId) return
  submitting.value = true

  const formData = new FormData()
  formData.append('displayName', form.value.displayName)
  formData.append('description', form.value.description)
  formData.append('categoryId', String(form.value.categoryId))
  if (form.value.barcode) {
    formData.append('barcode', form.value.barcode)
  }
  if (imageFile.value) {
    formData.append('image', imageFile.value)
  }
  formData.append('allergenIds', JSON.stringify(form.value.allergenIds))
  router.post(`/supplier/products/${props.product.id}?_method=PUT`, formData, {
    onFinish: () => (submitting.value = false),
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
                @keydown.enter.prevent="onNameEnter"
              />
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
                @keydown.enter.prevent="onDescriptionEnter"
              />
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
              />
            </div>

            <div>
              <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
                t('supplier.products_barcode_label')
              }}</label>
              <InputText id="edit-product-barcode" v-model="form.barcode" class="w-full" />
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
                :loading="submitting"
                :disabled="!form.displayName || !form.categoryId"
              />
            </div>
          </form>
        </template>
      </Card>
    </div>
  </AppLayout>
</template>
