<script setup lang="ts">
import { Head, router, useForm } from '@inertiajs/vue3'
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

const form = useForm({
  displayName: '',
  description: '',
  categoryId: null as number | null,
  barcode: '',
  image: null as File | null,
})

function onImageSelect(event: any) {
  form.image = event.files[0] ?? null
  if (form.image) {
    form.clearErrors('image')
  }
}

function submit() {
  if (!form.image) {
    form.setError('image', t('supplier.products_image_required'))
    return
  }

  form.post('/supplier/products', {
    forceFormData: true,
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.products_new_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.products_new_heading') }}
    </h1>

    <Card class="max-w-2xl">
      <template #content>
        <form @submit.prevent="submit" class="flex flex-col gap-5">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.products_name_label')
            }}</label>
            <InputText
              v-model="form.displayName"
              :placeholder="t('supplier.products_name_placeholder')"
              class="w-full"
              :invalid="!!form.errors.displayName"
            />
            <small v-if="form.errors.displayName" class="text-red-600 dark:text-red-400">{{
              form.errors.displayName
            }}</small>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.products_description_label')
            }}</label>
            <Textarea
              v-model="form.description"
              rows="3"
              :placeholder="t('supplier.products_description_placeholder')"
              class="w-full"
              :invalid="!!form.errors.description"
            />
            <small v-if="form.errors.description" class="text-red-600 dark:text-red-400">{{
              form.errors.description
            }}</small>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.products_category_label')
            }}</label>
            <Select
              v-model="form.categoryId"
              :options="categories"
              optionLabel="name"
              optionValue="id"
              :placeholder="t('supplier.products_category_label')"
              class="w-full"
              :invalid="!!form.errors.categoryId"
            />
            <small v-if="form.errors.categoryId" class="text-red-600 dark:text-red-400">{{
              form.errors.categoryId
            }}</small>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.products_barcode_label')
            }}</label>
            <InputText
              v-model="form.barcode"
              :placeholder="t('supplier.products_barcode_placeholder')"
              class="w-full"
              :invalid="!!form.errors.barcode"
            />
            <small v-if="form.errors.barcode" class="text-red-600 dark:text-red-400">{{
              form.errors.barcode
            }}</small>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
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
            <small v-if="form.errors.image" class="text-red-600 dark:text-red-400">{{
              form.errors.image
            }}</small>
          </div>

          <div class="flex gap-2 pt-2">
            <Button
              type="submit"
              :label="t('supplier.products_create_submit')"
              icon="pi pi-check"
              :loading="form.processing"
              :disabled="!form.displayName || !form.categoryId || !form.image"
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
