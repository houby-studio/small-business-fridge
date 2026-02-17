<script setup lang="ts">
import { Head, router, Link } from '@inertiajs/vue3'
import KioskLayout from '~/layouts/KioskLayout.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Message from 'primevue/message'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/useI18n'

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

interface ProductItem {
  id: number
  displayName: string
  imagePath: string | null
  price: number | null
  deliveryId: number | null
  stockSum: number
  category: { name: string; color: string }
}

const props = defineProps<{
  customer: CustomerInfo | null
  products: ProductItem[]
  categories: any[]
  error: string | null
}>()

const confirm = useConfirm()
const { t } = useI18n()

function purchase(product: ProductItem) {
  if (!props.customer || !product.deliveryId) return

  confirm.require({
    message: t('kiosk.purchase_confirm', { name: product.displayName, price: product.price ?? 0 }),
    header: t('kiosk.purchase_confirm_title'),
    icon: 'pi pi-shopping-cart',
    acceptLabel: t('kiosk.purchase_accept'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      router.post('/kiosk/purchase', {
        customerId: props.customer!.id,
        deliveryId: product.deliveryId,
      })
    },
  })
}
</script>

<template>
  <KioskLayout>
    <Head :title="t('kiosk.shop_title')" />
    <ConfirmDialog />

    <div class="min-h-screen p-6">
      <!-- Header -->
      <div class="mb-6 flex items-center justify-between">
        <div v-if="customer">
          <h1 class="text-2xl font-bold text-white">
            {{ t('kiosk.greeting', { name: customer.displayName }) }}
          </h1>
          <p class="text-gray-400">ID: {{ customer.keypadId }}</p>
        </div>
        <Link href="/kiosk">
          <Button :label="t('common.back')" icon="pi pi-arrow-left" severity="secondary" />
        </Link>
      </div>

      <!-- Error -->
      <Message v-if="error" severity="error" :closable="false" class="mb-6">
        {{ error }}
      </Message>

      <!-- Success message from URL params -->
      <Message v-if="$page.url.includes('success=1')" severity="success" :closable="false" class="mb-6">
        {{ t('kiosk.purchase_success') }}
      </Message>
      <Message v-if="$page.url.includes('error=out_of_stock')" severity="error" :closable="false" class="mb-6">
        {{ t('kiosk.purchase_out_of_stock') }}
      </Message>

      <!-- Products grid -->
      <div v-if="customer && products.length > 0" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Card
          v-for="product in products"
          :key="product.id"
          class="cursor-pointer transition-all hover:scale-105"
          @click="purchase(product)"
        >
          <template #content>
            <div class="text-center">
              <img
                v-if="product.imagePath"
                :src="product.imagePath"
                :alt="product.displayName"
                class="mx-auto mb-2 h-24 w-24 rounded-lg object-cover"
              />
              <div
                v-else
                class="mx-auto mb-2 flex h-24 w-24 items-center justify-center rounded-lg bg-gray-700"
              >
                <i class="pi pi-box text-3xl text-gray-500" />
              </div>
              <h3 class="text-sm font-semibold">{{ product.displayName }}</h3>
              <div class="mt-1 text-lg font-bold text-green-400">{{ t('common.price_with_currency', { price: product.price ?? 0 }) }}</div>
              <div class="mt-0.5 text-xs text-gray-400">{{ t('common.pieces_in_stock', { count: product.stockSum }) }}</div>
            </div>
          </template>
        </Card>
      </div>

      <div v-else-if="customer && products.length === 0" class="py-20 text-center text-gray-400">
        <i class="pi pi-inbox mb-4 text-5xl" />
        <p class="text-xl">{{ t('kiosk.no_products') }}</p>
      </div>
    </div>
  </KioskLayout>
</template>
