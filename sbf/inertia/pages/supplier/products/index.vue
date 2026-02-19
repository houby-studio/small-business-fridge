<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useI18n } from '~/composables/use_i18n'

interface ProductRow {
  id: number
  keypadId: number
  displayName: string
  imagePath: string | null
  barcode: string | null
  category: { id: number; name: string; color: string } | null
}

interface PaginatedProducts {
  data: ProductRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

interface CategoryOption {
  id: number
  name: string
  color: string
}

const props = defineProps<{
  products: PaginatedProducts
  categories: CategoryOption[]
  filters: { search: string; categoryId: string }
}>()
const { t } = useI18n()

const filterSearch = ref(props.filters.search)
const filterCategoryId = ref(props.filters.categoryId)

const categoryOptions = ref([
  { label: t('common.all'), value: '' },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])

function applyFilters() {
  router.get(
    '/supplier/products',
    {
      search: filterSearch.value || undefined,
      categoryId: filterCategoryId.value || undefined,
      page: 1,
    },
    { preserveState: true, only: ['products', 'filters'] }
  )
}

function clearFilters() {
  filterSearch.value = ''
  filterCategoryId.value = ''
  router.get('/supplier/products', {}, { preserveState: true, only: ['products', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/supplier/products',
    {
      search: filterSearch.value || undefined,
      categoryId: filterCategoryId.value || undefined,
      page: event.page + 1,
    },
    { preserveState: true, only: ['products', 'filters'] }
  )
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.products_list_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.products_list_heading') }}
      </h1>
      <Button
        :label="t('supplier.products_new_title')"
        icon="pi pi-plus"
        @click="router.get('/supplier/products/new')"
      />
    </div>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('supplier.products_search')
        }}</label>
        <InputText v-model="filterSearch" class="w-56" @keydown.enter="applyFilters" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('supplier.products_filter_category')
        }}</label>
        <Select
          v-model="filterCategoryId"
          :options="categoryOptions"
          optionLabel="label"
          optionValue="value"
          class="w-44"
        />
      </div>
      <Button
        :label="t('common.filter_apply')"
        icon="pi pi-filter"
        size="small"
        @click="applyFilters"
      />
      <Button
        :label="t('common.filter_clear')"
        size="small"
        severity="secondary"
        text
        @click="clearFilters"
      />
    </div>

    <DataTable
      :value="products.data"
      :paginator="products.meta.lastPage > 1"
      :rows="products.meta.perPage"
      :totalRecords="products.meta.total"
      :lazy="true"
      :first="(products.meta.currentPage - 1) * products.meta.perPage"
      @page="onPageChange"
      stripedRows
      class="rounded-lg border"
    >
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
          <span v-else class="pi pi-image text-2xl text-gray-300 dark:text-zinc-600" />
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
          <span v-else class="text-gray-400 dark:text-zinc-500">—</span>
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
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.products_list_empty') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
