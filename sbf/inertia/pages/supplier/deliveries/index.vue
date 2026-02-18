<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Card from 'primevue/card'
import { useI18n } from '~/composables/useI18n'
import { formatDate } from '~/composables/useFormatDate'

interface ProductOption {
  id: number
  displayName: string
  imagePath: string | null
  category: { name: string; color: string } | null
}

interface DeliveryRow {
  id: number
  amountSupplied: number
  amountLeft: number
  price: number
  createdAt: string
  product: { displayName: string; category?: { name: string } }
}

interface PaginatedDeliveries {
  data: DeliveryRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  products: ProductOption[]
  recentDeliveries: PaginatedDeliveries
}>()

const { t } = useI18n()

const selectedProduct = ref<number | null>(null)
const amount = ref<number | null>(null)
const price = ref<number | null>(null)
const submitting = ref(false)

function submit() {
  if (!selectedProduct.value || !amount.value || !price.value) return
  submitting.value = true
  router.post(
    '/supplier/deliveries',
    {
      productId: selectedProduct.value,
      amount: amount.value,
      price: price.value,
    },
    {
      onFinish: () => {
        submitting.value = false
        selectedProduct.value = null
        amount.value = null
        price.value = null
      },
    }
  )
}

function onPageChange(event: any) {
  router.get('/supplier/deliveries', { page: event.page + 1 }, { preserveState: true })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.deliveries_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('supplier.deliveries_heading') }}</h1>

    <!-- Add stock form -->
    <Card class="mb-8">
      <template #content>
        <form @submit.prevent="submit" class="flex flex-wrap items-end gap-4">
          <div class="min-w-[250px] flex-1">
            <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('supplier.deliveries_product') }}</label>
            <Select
              v-model="selectedProduct"
              :options="products"
              optionLabel="displayName"
              optionValue="id"
              :placeholder="t('supplier.deliveries_product')"
              filter
              class="w-full"
            />
          </div>
          <div class="w-32">
            <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('supplier.deliveries_amount') }}</label>
            <InputNumber
              v-model="amount"
              :min="1"
              :placeholder="t('common.pieces')"
              class="w-full"
            />
          </div>
          <div class="w-32">
            <label class="mb-1 block text-sm font-medium text-gray-700">{{ t('supplier.deliveries_price') }}</label>
            <InputNumber
              v-model="price"
              :min="1"
              :suffix="' ' + t('common.currency')"
              :placeholder="t('common.currency')"
              class="w-full"
            />
          </div>
          <Button
            type="submit"
            :label="t('supplier.deliveries_submit')"
            icon="pi pi-plus"
            :loading="submitting"
            :disabled="!selectedProduct || !amount || !price"
          />
        </form>
      </template>
    </Card>

    <!-- Recent deliveries -->
    <h2 class="mb-4 text-lg font-semibold text-gray-800">{{ t('supplier.deliveries_recent') }}</h2>
    <DataTable
      :value="recentDeliveries.data"
      :paginator="recentDeliveries.meta.lastPage > 1"
      :rows="recentDeliveries.meta.perPage"
      :totalRecords="recentDeliveries.meta.total"
      :lazy="true"
      :first="(recentDeliveries.meta.currentPage - 1) * recentDeliveries.meta.perPage"
      @page="onPageChange"
      stripedRows
      class="rounded-lg border"
    >
      <Column :header="t('common.date')">
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">{{ data.product?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('supplier.deliveries_amount')" style="width: 100px">
        <template #body="{ data }">{{ data.amountSupplied }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('supplier.deliveries_remaining')" style="width: 100px">
        <template #body="{ data }">{{ data.amountLeft }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('common.price')" style="width: 100px">
        <template #body="{ data }">{{ t('common.price_with_currency', { price: data.price }) }}</template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500">{{ t('supplier.deliveries_none') }}</div>
      </template>
    </DataTable>
  </AppLayout>
</template>
