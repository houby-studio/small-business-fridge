<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useI18n } from '~/composables/use_i18n'
import { useListFilters } from '~/composables/use_list_filters'
import FilterBar from '~/components/FilterBar.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

interface ProductRow {
  id: number
  keypadId: number
  displayName: string
  imagePath: string | null
  barcode: string | null
  category: { id: number; name: string; color: string } | null
  allergens: { id: number; name: string }[]
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
const ALL = '__all__'

const filterSearch = ref(props.filters.search ?? '')
const filterCategoryId = ref(props.filters.categoryId || ALL)

const categoryOptions = ref([
  { label: t('common.all'), value: ALL },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])

function buildFilterParams() {
  return {
    search: filterSearch.value || undefined,
    categoryId: filterCategoryId.value === ALL ? undefined : filterCategoryId.value,
  }
}

const { applyFilters, navigateClear, onPageChange } = useListFilters({
  route: '/supplier/products',
  onlyProps: ['products', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.products.meta.currentPage,
})

function clearFilters() {
  filterSearch.value = ''
  filterCategoryId.value = ALL
  navigateClear()
}

function formatAllergenList(allergens: ProductRow['allergens']) {
  return allergens.map((allergen) => allergen.name).join(', ')
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
        size="small"
        @click="router.get('/supplier/products/new')"
      />
    </div>

    <!-- Filter bar -->
    <FilterBar @apply="applyFilters" @clear="clearFilters">
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
    </FilterBar>

    <PaginatedDataTable :value="products.data" :meta="products.meta" @page="onPageChange">
      <Column header="#" style="width: 60px">
        <template #body="{ data }">{{ data.keypadId }}</template>
      </Column>
      <Column :header="t('supplier.products_image_label')" style="width: 60px">
        <template #body="{ data }">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-md bg-gray-100 p-0.5 dark:bg-zinc-800"
          >
            <img
              v-if="data.imagePath"
              :src="data.imagePath"
              :alt="data.displayName"
              class="h-full w-full rounded object-contain"
            />
            <span v-else class="pi pi-image text-lg text-gray-300 dark:text-zinc-600" />
          </div>
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
      <Column :header="t('supplier.products_allergens_label')">
        <template #body="{ data }">
          <span v-if="data.allergens?.length">
            {{ formatAllergenList(data.allergens) }}
          </span>
          <span v-else class="text-gray-400 dark:text-zinc-500">—</span>
        </template>
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
    </PaginatedDataTable>
  </AppLayout>
</template>
