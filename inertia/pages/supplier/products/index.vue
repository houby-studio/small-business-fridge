<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useI18n } from '~/composables/use_i18n'
import { useListFilters } from '~/composables/use_list_filters'
import { useFilterSearch } from '~/composables/use_filter_search'
import FilterBar from '~/components/FilterBar.vue'
import InfoHint from '~/components/InfoHint.vue'
import ProductImage from '~/components/ProductImage.vue'
import PageTabs from '~/components/PageTabs.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

interface ProductRow {
  id: number
  keypadId: number
  displayName: string
  imagePath: string | null
  barcode: string | null
  category: { id: number; name: string; color: string } | null
  allergens: { id: number; name: string }[]
  productGroup: { id: number; name: string } | null
  archived: boolean
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
  filters: {
    search: string
    categoryId: string
    sortBy: string
    sortOrder: string
    status: 'active' | 'archived' | 'all'
    photo: '' | 'missing'
  }
}>()
const { t } = useI18n()
const ALL = '__all__'

const tabs = computed(() => [
  { label: t('common.tab_products'), url: '/supplier/products', testId: 'tab-products' },
  {
    label: t('common.tab_product_groups'),
    url: '/supplier/product-groups',
    testId: 'tab-product-groups',
  },
])

const filterSearch = ref(props.filters.search ?? '')
const filterCategoryId = ref(props.filters.categoryId || ALL)
const filterStatus = ref(props.filters.status || 'active')
const filterPhoto = ref(props.filters.photo || ALL)
const filterSortBy = ref(props.filters.sortBy || 'displayName')
const filterSortOrder = ref(props.filters.sortOrder || 'asc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const statusOptions = computed(() => [
  { label: t('common.all'), value: 'all' },
  { label: t('supplier.products_status_active'), value: 'active' },
  { label: t('supplier.products_status_archived'), value: 'archived' },
])

const photoOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  { label: t('supplier.products_photo_missing'), value: 'missing' },
])

/** "Clear" only while something differs from the defaults (active products, any photo). */
const filtersActive = computed(
  () =>
    !!filterSearch.value ||
    filterCategoryId.value !== ALL ||
    filterStatus.value !== 'active' ||
    filterPhoto.value !== ALL
)

const categoryOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])

function buildFilterParams() {
  return {
    search: filterSearch.value || undefined,
    categoryId: filterCategoryId.value === ALL ? undefined : filterCategoryId.value,
    status: filterStatus.value === 'active' ? undefined : filterStatus.value,
    photo: filterPhoto.value === ALL ? undefined : filterPhoto.value,
    sortBy: filterSortBy.value,
    sortOrder: filterSortOrder.value,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/supplier/products',
  onlyProps: ['products', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.products.meta.currentPage,
})

// Searching starts while typing (debounced), on Enter and on leaving the field.
const searchField = useFilterSearch(filterSearch, {
  apply: applyFilters,
  getApplied: () => props.filters.search,
})

/** A Select applies at once — and takes a pending search along instead of sending it twice. */
function applyNow() {
  searchField.cancel()
  applyFilters()
}

function clearFilters() {
  searchField.cancel()
  filterSearch.value = ''
  filterCategoryId.value = ALL
  filterStatus.value = 'active'
  filterPhoto.value = ALL
  filterSortBy.value = 'displayName'
  filterSortOrder.value = 'asc'
  navigateClear()
}

function onSort(event: { sortField?: unknown; sortOrder?: number | null }) {
  filterSortBy.value = typeof event.sortField === 'string' ? event.sortField : 'displayName'
  filterSortOrder.value = event.sortOrder === -1 ? 'desc' : 'asc'
  navigateSort()
}

function formatAllergenList(allergens: ProductRow['allergens']) {
  return allergens.map((allergen) => allergen.name).join(', ')
}

/**
 * "Stock" adds the product as a line of the supplier's open draft (příjemka). One request
 * at a time, so a double click does not add the product twice.
 */
const receiving = ref(false)
function receive(productId: number) {
  if (receiving.value) return
  receiving.value = true
  router.post(
    '/supplier/stock/drafts',
    { productId },
    {
      onFinish: () => {
        receiving.value = false
      },
    }
  )
}

/**
 * Archive hides a product nobody stocks any more from the shop, the kiosk and the pickers;
 * the server refuses while pieces are left or a draft has it, and says why. Reversible, so
 * no confirmation. The list keeps its filters (redirect back) and scroll position.
 */
const archivingId = ref<number | null>(null)
function setArchived(product: ProductRow, archived: boolean) {
  if (archivingId.value !== null) return
  archivingId.value = product.id
  const options = {
    preserveScroll: true,
    onFinish: () => {
      archivingId.value = null
    },
  }
  // Two literal paths so `npm run check:routes` can match each call to its route.
  if (archived) {
    router.post(`/supplier/products/${product.id}/archive`, {}, options)
  } else {
    router.post(`/supplier/products/${product.id}/unarchive`, {}, options)
  }
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.products_list_title')" />

    <div class="mb-3 flex min-h-10 items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.products_list_title') }}
      </h1>
      <Button
        :label="t('supplier.products_new_title')"
        icon="pi pi-plus"
        data-testid="product-create"
        @click="router.get('/supplier/products/new')"
      />
    </div>
    <PageTabs :tabs="tabs" />

    <FilterBar :active="filtersActive" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.product')
        }}</label>
        <InputText
          v-model="filterSearch"
          class="w-48"
          data-testid="products-search"
          @input="searchField.onInput"
          @keydown.enter="searchField.flush"
          @blur="searchField.flush"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.category')
        }}</label>
        <Select
          v-model="filterCategoryId"
          :options="categoryOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          @change="applyNow"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.status')
        }}</label>
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          class="w-40"
          data-testid="products-status"
          @change="applyNow"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.products_photo_filter')
        }}</label>
        <Select
          v-model="filterPhoto"
          :options="photoOptions"
          optionLabel="label"
          optionValue="value"
          class="w-40"
          data-testid="products-photo"
          @change="applyNow"
        />
      </div>
    </FilterBar>

    <PaginatedDataTable
      :value="products.data"
      :meta="products.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column :header="t('common.keypad_code')" field="keypadId" sortable style="width: 60px">
        <template #header>
          <!-- .stop: opening the hint must not sort the column. -->
          <span @click.stop>
            <InfoHint :text="t('common.keypad_code_hint')" test-id="keypad-code-hint" />
          </span>
        </template>
        <template #body="{ data }">{{ data.keypadId }}</template>
      </Column>
      <Column style="width: 48px">
        <template #header>
          <span class="sr-only">{{ t('supplier.products_image_label') }}</span>
        </template>
        <template #body="{ data }">
          <div class="h-10 w-10 rounded-md bg-gray-100 p-0.5 dark:bg-zinc-800">
            <ProductImage
              :src="data.imagePath"
              :alt="data.displayName"
              :color="data.category?.color"
              iconClass="text-lg"
              imgClass="rounded object-contain"
            />
          </div>
        </template>
      </Column>
      <Column :header="t('supplier.products_name_label')" field="displayName" sortable>
        <template #body="{ data }">
          <span :class="{ 'text-gray-500 dark:text-zinc-400': data.archived }">{{
            data.displayName
          }}</span>
          <span
            v-if="data.archived"
            class="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-zinc-700 dark:text-zinc-200"
            data-testid="product-archived-badge"
            >{{ t('supplier.products_archived_badge') }}</span
          >
          <span
            v-if="!data.imagePath"
            class="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-zinc-700 dark:text-zinc-200"
            data-testid="product-no-photo-badge"
            >{{ t('supplier.products_no_photo_badge') }}</span
          >
        </template>
      </Column>
      <Column :header="t('supplier.products_category_label')" field="category" sortable>
        <template #body="{ data }">
          <Tag
            v-if="data.category"
            :value="data.category.name"
            :style="{ background: data.category.color, color: '#ffffff' }"
            class="text-xs !text-white"
          />
          <span v-else class="text-gray-400 dark:text-zinc-500">—</span>
        </template>
      </Column>
      <Column :header="t('shopping.kind_group')">
        <template #body="{ data }">
          <Link v-if="data.productGroup" href="/supplier/product-groups" class="hover:underline">{{
            data.productGroup.name
          }}</Link>
          <span v-else class="text-gray-400 dark:text-zinc-500">—</span>
        </template>
      </Column>
      <Column :header="t('supplier.products_barcode_label')">
        <template #body="{ data }">{{ data.barcode ?? '—' }}</template>
      </Column>
      <Column
        :header="t('supplier.products_allergens_label')"
        headerClass="hidden lg:table-cell"
        bodyClass="hidden lg:table-cell"
      >
        <template #body="{ data }">
          <span v-if="data.allergens?.length">
            {{ formatAllergenList(data.allergens) }}
          </span>
          <span v-else class="text-gray-400 dark:text-zinc-500">—</span>
        </template>
      </Column>
      <Column :header="t('common.actions')" style="width: 140px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              icon="pi pi-plus"
              severity="secondary"
              text
              size="small"
              :aria-label="t('supplier.stock_receive')"
              :disabled="receiving"
              data-testid="product-row-receive"
              @click="receive(data.id)"
            />
            <Button
              icon="pi pi-pencil"
              severity="info"
              text
              size="small"
              :aria-label="t('common.edit')"
              data-testid="product-row-edit"
              @click="router.get(`/supplier/products/${data.id}/edit`)"
            />
            <Button
              v-if="!data.archived"
              icon="pi pi-inbox"
              severity="warn"
              text
              size="small"
              :aria-label="t('supplier.products_archive')"
              :loading="archivingId === data.id"
              :disabled="archivingId !== null"
              data-testid="product-row-archive"
              @click="setArchived(data, true)"
            />
            <Button
              v-else
              icon="pi pi-replay"
              severity="secondary"
              text
              size="small"
              :aria-label="t('supplier.products_unarchive')"
              :loading="archivingId === data.id"
              :disabled="archivingId !== null"
              data-testid="product-row-unarchive"
              @click="setArchived(data, false)"
            />
          </div>
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
