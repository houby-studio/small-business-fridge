<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import Card from 'primevue/card'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useI18n } from '~/composables/use_i18n'

// CAMERA TODO: 'detecting' state — mount <video ref="cameraFeed" autoplay /> here
// CAMERA TODO: 'product_found' state — show DetectedProduct[] cards with confidence %
// CAMERA TODO: 'person_found' state — show PersonCandidate, swap keypad for confirm card
// CAMERA TODO: lock-in mechanism — cache detection for 3s, require tap to confirm
// CAMERA TODO: multi-product handling — render v-for DetectedProduct[], allow multi-buy

export type PanelState = 'idle' | 'identified'
// Future states (typed but not rendered):
// | 'detecting'
// | 'product_found'
// | 'person_found'

interface ProductItem {
  id: number
  displayName: string
  imagePath: string | null
  price: number | null
  deliveryId: number | null
  stockSum: number
  isFavorite: boolean
  category: { name: string; color: string }
}

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

const props = defineProps<{
  state: PanelState
  featuredProducts: ProductItem[]
  personalizedProducts: ProductItem[]
  customer: CustomerInfo | null
  keypadId: string
}>()

const { t } = useI18n()
const confirm = useConfirm()
const toast = useToast()

function onIdleProductTap() {
  toast.add({
    severity: 'info',
    summary: t('kiosk.enter_id_to_buy'),
    life: 2500,
  })
}

function purchaseProduct(product: ProductItem) {
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
  <div class="flex h-full flex-col p-6">
    <ConfirmDialog />

    <!-- ── IDLE STATE ── -->
    <template v-if="state === 'idle'">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-white">{{ t('kiosk.featured_products') }}</h2>
        <p class="mt-1 text-sm text-gray-400">{{ t('kiosk.enter_id_to_buy') }}</p>
      </div>

      <div
        v-if="featuredProducts.length > 0"
        class="grid grid-cols-2 gap-4 overflow-y-auto"
        style="max-height: calc(100vh - 160px)"
      >
        <div
          v-for="product in featuredProducts"
          :key="product.id"
          class="cursor-pointer"
          @click="onIdleProductTap"
        >
          <Card
            class="h-full transition-all hover:scale-105"
            :style="{ borderBottom: `4px solid ${product.category.color}` }"
          >
            <template #content>
              <div class="relative text-center">
                <!-- Low-stock badge -->
                <div
                  v-if="product.stockSum <= 5"
                  class="absolute right-0 top-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white"
                >
                  {{ t('kiosk.low_stock', { count: product.stockSum }) }}
                </div>

                <img
                  v-if="product.imagePath"
                  :src="product.imagePath"
                  :alt="product.displayName"
                  class="mx-auto mb-2 h-32 w-full object-contain"
                />
                <div
                  v-else
                  class="mx-auto mb-2 flex h-32 w-full items-center justify-center rounded-lg bg-gray-700"
                >
                  <i class="pi pi-box text-4xl text-gray-500" />
                </div>
                <h3 class="text-sm font-semibold text-white">{{ product.displayName }}</h3>
                <div class="mt-1 text-lg font-bold text-green-400">
                  {{ t('common.price_with_currency', { price: product.price ?? 0 }) }}
                </div>
                <div class="mt-0.5 text-xs text-gray-400">
                  {{ t('common.pieces_in_stock', { count: product.stockSum }) }}
                </div>
              </div>
            </template>
          </Card>
        </div>
      </div>

      <div v-else class="flex flex-1 items-center justify-center text-gray-500">
        <div class="text-center">
          <i class="pi pi-inbox mb-4 text-5xl" />
          <p class="text-xl">{{ t('kiosk.no_products') }}</p>
        </div>
      </div>
    </template>

    <!-- ── IDENTIFIED STATE ── -->
    <template v-else-if="state === 'identified'">
      <!-- Greeting banner -->
      <div
        class="mb-4 rounded-2xl bg-gray-800/60 p-4 backdrop-blur-sm"
        style="border: 1px solid rgb(55 65 81 / 0.5)"
      >
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-white">
              {{ t('kiosk.greeting', { name: customer!.displayName }) }}
            </h2>
            <p class="mt-0.5 text-sm text-gray-400">{{ t('kiosk.quick_pick') }}</p>
          </div>
          <a
            :href="`/kiosk/shop?keypadId=${keypadId}`"
            class="flex items-center gap-2 rounded-xl bg-gray-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600"
          >
            {{ t('kiosk.see_all_products') }}
            <i class="pi pi-arrow-right text-xs" />
          </a>
        </div>
      </div>

      <!-- Your picks heading -->
      <h3 class="mb-3 text-lg font-semibold text-gray-300">{{ t('kiosk.your_picks') }}</h3>

      <div
        v-if="personalizedProducts.length > 0"
        class="grid grid-cols-2 gap-4 overflow-y-auto"
        style="max-height: calc(100vh - 240px)"
      >
        <div
          v-for="product in personalizedProducts"
          :key="product.id"
          :class="{
            'sbf-card-both': product.isRecommended && product.isFavorite,
            'sbf-card-recommended': product.isRecommended && !product.isFavorite,
            'sbf-card-favorite': product.isFavorite && !product.isRecommended,
          }"
          class="cursor-pointer"
          @click="purchaseProduct(product)"
        >
          <Card
            class="h-full transition-all hover:scale-105"
            :style="{ borderBottom: `4px solid ${product.category.color}` }"
          >
            <template #content>
              <div class="relative text-center">
                <!-- Low-stock badge -->
                <div
                  v-if="product.stockSum <= 5"
                  class="absolute right-0 top-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white"
                >
                  {{ t('kiosk.low_stock', { count: product.stockSum }) }}
                </div>

                <img
                  v-if="product.imagePath"
                  :src="product.imagePath"
                  :alt="product.displayName"
                  class="mx-auto mb-2 h-32 w-full object-contain"
                />
                <div
                  v-else
                  class="mx-auto mb-2 flex h-32 w-full items-center justify-center rounded-lg bg-gray-700"
                >
                  <i class="pi pi-box text-4xl text-gray-500" />
                </div>
                <h3 class="text-sm font-semibold text-white">{{ product.displayName }}</h3>
                <div class="mt-1 text-lg font-bold text-green-400">
                  {{ t('common.price_with_currency', { price: product.price ?? 0 }) }}
                </div>
                <div class="mt-0.5 text-xs text-gray-400">
                  {{ t('common.pieces_in_stock', { count: product.stockSum }) }}
                </div>
              </div>
            </template>
          </Card>
        </div>
      </div>

      <div v-else class="flex flex-1 items-center justify-center text-gray-500">
        <div class="text-center">
          <i class="pi pi-inbox mb-4 text-5xl" />
          <p class="text-xl">{{ t('kiosk.no_products') }}</p>
        </div>
      </div>
    </template>

    <!-- CAMERA TODO: 'detecting' state — mount <video ref="cameraFeed" autoplay /> here -->
    <!-- CAMERA TODO: 'product_found' state — show DetectedProduct[] cards with confidence % -->
    <!-- CAMERA TODO: 'person_found' state — show PersonCandidate, swap keypad for confirm card -->
  </div>
</template>
