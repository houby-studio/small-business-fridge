<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useI18n } from '~/composables/use_i18n'

interface ProductRow {
  id: number
  keypadId: number
  displayName: string
  imagePath: string | null
  barcode: string | null
  category: { id: number; name: string; color: string } | null
}

defineProps<{ products: ProductRow[] }>()
const { t } = useI18n()
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.products_list_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">{{ t('supplier.products_list_heading') }}</h1>
      <Button
        :label="t('supplier.products_new_title')"
        icon="pi pi-plus"
        @click="router.get('/supplier/products/new')"
      />
    </div>

    <DataTable :value="products" stripedRows class="rounded-lg border">
      <Column header="#" style="width: 60px">
        <template #body="{ data }">{{ data.keypadId }}</template>
      </Column>
      <Column :header="t('supplier.products_image_label')" style="width: 60px">
        <template #body="{ data }">
          <img
            v-if="data.imagePath"
            :src="data.imagePath"
            :alt="data.displayName"
            class="h-10 w-10 rounded object-cover"
          />
          <span v-else class="pi pi-image text-2xl text-gray-300" />
        </template>
      </Column>
      <Column :header="t('supplier.products_name_label')">
        <template #body="{ data }">{{ data.displayName }}</template>
      </Column>
      <Column :header="t('supplier.products_category_label')">
        <template #body="{ data }">
          <Tag
            v-if="data.category"
            :value="data.category.name"
            :style="{ background: data.category.color }"
            class="text-xs text-white"
          />
          <span v-else class="text-gray-400">—</span>
        </template>
      </Column>
      <Column :header="t('supplier.products_barcode_label')">
        <template #body="{ data }">{{ data.barcode ?? '—' }}</template>
      </Column>
      <Column :header="t('common.actions')" style="width: 100px">
        <template #body="{ data }">
          <Button
            icon="pi pi-pencil"
            size="small"
            severity="secondary"
            text
            @click="router.get(`/supplier/products/${data.id}/edit`)"
          />
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500">{{ t('supplier.products_list_empty') }}</div>
      </template>
    </DataTable>
  </AppLayout>
</template>
