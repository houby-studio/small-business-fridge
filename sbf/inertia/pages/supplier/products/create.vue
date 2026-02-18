<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import FileUpload from 'primevue/fileupload'
import Button from 'primevue/button'
import Card from 'primevue/card'
import { useI18n } from '~/composables/use_i18n'

interface CategoryOption {
  id: number
  name: string
  color: string
}

const props = defineProps<{ categories: CategoryOption[] }>()
const { t } = useI18n()

const form = ref({
  displayName: '',
  description: '',
  categoryId: null as number | null,
  barcode: '',
})
const imageFile = ref<File | null>(null)
const submitting = ref(false)

function onImageSelect(event: any) {
  imageFile.value = event.files[0] ?? null
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

  router.post('/supplier/products', formData, {
    onFinish: () => (submitting.value = false),
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.products_new_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('supplier.products_new_heading') }}</h1>

    <Card class="max-w-2xl">
      <template #content>
        <form @submit.prevent="submit" class="flex flex-col gap-5">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">{{
              t('supplier.products_name_label')
            }}</label>
            <InputText
              v-model="form.displayName"
              :placeholder="t('supplier.products_name_placeholder')"
              class="w-full"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">{{
              t('supplier.products_description_label')
            }}</label>
            <Textarea
              v-model="form.description"
              rows="3"
              :placeholder="t('supplier.products_description_placeholder')"
              class="w-full"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">{{
              t('supplier.products_category_label')
            }}</label>
            <Select
              v-model="form.categoryId"
              :options="categories"
              optionLabel="name"
              optionValue="id"
              :placeholder="t('supplier.products_category_label')"
              class="w-full"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">{{
              t('supplier.products_barcode_label')
            }}</label>
            <InputText
              v-model="form.barcode"
              :placeholder="t('supplier.products_barcode_placeholder')"
              class="w-full"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700">{{
              t('supplier.products_image_label')
            }}</label>
            <FileUpload
              mode="basic"
              accept="image/*"
              :maxFileSize="5000000"
              :chooseLabel="t('supplier.products_image_choose')"
              @select="onImageSelect"
              :auto="false"
            />
          </div>

          <div class="flex gap-2 pt-2">
            <Button
              type="submit"
              :label="t('supplier.products_create_submit')"
              icon="pi pi-check"
              :loading="submitting"
              :disabled="!form.displayName || !form.categoryId"
            />
            <Button
              :label="t('common.cancel')"
              severity="secondary"
              outlined
              @click="router.get('/supplier/stock')"
            />
          </div>
        </form>
      </template>
    </Card>
  </AppLayout>
</template>
