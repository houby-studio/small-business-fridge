<script setup lang="ts">
import { computed } from 'vue'
import { Head, Link } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

interface StockRow {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  totalSupplied: number
  totalRemaining: number
  totalSold: number
  deliveryCount: number
  totalRevenue: number
}

const props = defineProps<{ stock: StockRow[] }>()
const { t } = useI18n()

const totalProducts = computed(() => props.stock.length)
const totalRemaining = computed(() => props.stock.reduce((s, r) => s + r.totalRemaining, 0))
const totalRevenue = computed(() => props.stock.reduce((s, r) => s + r.totalRevenue, 0))

function stockSeverity(remaining: number): 'success' | 'warn' | 'danger' {
  if (remaining >= 5) return 'success'
  if (remaining > 0) return 'warn'
  return 'danger'
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.stock_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">{{ t('supplier.stock_heading') }}</h1>
      <div class="flex gap-2">
        <Link href="/supplier/products/new">
          <Button :label="t('supplier.stock_new_product')" icon="pi pi-plus" size="small" />
        </Link>
        <Link href="/supplier/deliveries">
          <Button
            :label="t('supplier.deliveries_submit')"
            icon="pi pi-box"
            size="small"
            severity="secondary"
          />
        </Link>
      </div>
    </div>

    <Message v-if="stock.length === 0" severity="info" :closable="false">
      {{ t('supplier.stock_none') }}
    </Message>

    <template v-else>
      <!-- Summary cards -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card class="text-center">
          <template #content>
            <div class="text-3xl font-bold">{{ totalProducts }}</div>
            <div class="text-sm text-gray-500">{{ t('supplier.stock_products') }}</div>
          </template>
        </Card>
        <Card class="text-center">
          <template #content>
            <div class="text-3xl font-bold">{{ totalRemaining }} {{ t('common.pieces') }}</div>
            <div class="text-sm text-gray-500">{{ t('supplier.stock_total_in_stock') }}</div>
          </template>
        </Card>
        <Card class="text-center">
          <template #content>
            <div class="text-3xl font-bold">
              {{ t('common.price_with_currency', { price: totalRevenue }) }}
            </div>
            <div class="text-sm text-gray-500">{{ t('supplier.stock_total_revenue') }}</div>
          </template>
        </Card>
      </div>

      <!-- Stock table -->
      <DataTable :value="stock" stripedRows class="rounded-lg border">
        <Column :header="t('common.product')">
          <template #body="{ data }">
            <div class="flex items-center gap-3">
              <img
                v-if="data.imagePath"
                :src="data.imagePath"
                :alt="data.productName"
                class="h-8 w-8 rounded object-cover"
              />
              <div>
                <div class="font-medium">{{ data.productName }}</div>
                <Tag
                  v-if="data.categoryName"
                  :value="data.categoryName"
                  class="mt-0.5 text-xs"
                  :style="{ backgroundColor: data.categoryColor, color: '#fff' }"
                />
              </div>
            </div>
          </template>
        </Column>
        <Column :header="t('supplier.stock_stocked')" style="width: 120px">
          <template #body="{ data }">{{ data.totalSupplied }} {{ t('common.pieces') }}</template>
        </Column>
        <Column :header="t('supplier.stock_in_stock')" style="width: 120px">
          <template #body="{ data }">
            <Tag
              :value="`${data.totalRemaining} ${t('common.pieces')}`"
              :severity="stockSeverity(data.totalRemaining)"
              class="text-xs"
            />
          </template>
        </Column>
        <Column :header="t('supplier.stock_sold')" style="width: 120px">
          <template #body="{ data }">{{ data.totalSold }} {{ t('common.pieces') }}</template>
        </Column>
        <Column :header="t('supplier.stock_total_revenue')" style="width: 120px">
          <template #body="{ data }">
            <span class="font-semibold">{{
              t('common.price_with_currency', { price: data.totalRevenue })
            }}</span>
          </template>
        </Column>
        <Column :header="t('common.actions')" style="width: 100px">
          <template #body="{ data }">
            <Link :href="`/supplier/products/${data.productId}/edit`">
              <Button icon="pi pi-pencil" size="small" severity="secondary" text />
            </Link>
          </template>
        </Column>
      </DataTable>
    </template>
  </AppLayout>
</template>
