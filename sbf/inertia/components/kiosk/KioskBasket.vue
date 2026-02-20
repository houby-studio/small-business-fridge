<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/use_i18n'

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

export interface BasketItem {
  deliveryId: number
  displayName: string
  imagePath: string | null
  price: number
  quantity: number
}

const props = defineProps<{
  customer: CustomerInfo
  items: BasketItem[]
  countdown: number
  checkoutLoading: boolean
  outOfStockDeliveryId: number | null
}>()

const emit = defineEmits<{
  updateQty: [deliveryId: number, qty: number]
  remove: [deliveryId: number]
  checkout: []
  cancel: []
}>()

const { t } = useI18n()

const total = computed(() => props.items.reduce((sum, i) => sum + i.price * i.quantity, 0))
const totalCount = computed(() => props.items.reduce((sum, i) => sum + i.quantity, 0))

const countdownClass = computed(() => {
  if (props.countdown <= 15) return 'text-red-400 animate-pulse'
  if (props.countdown <= 30) return 'text-yellow-400'
  return 'text-gray-500'
})
</script>

<template>
  <div class="flex h-full flex-col p-4">
    <!-- Customer header -->
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold text-white">{{ customer.displayName }}</h2>
        <p class="text-xs text-gray-500">ID: {{ customer.keypadId }}</p>
      </div>
      <button
        class="flex items-center gap-1.5 rounded-xl bg-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-600"
        @click="emit('cancel')"
      >
        <i class="pi pi-sign-out text-xs" />
        {{ t('kiosk.logout') }}
      </button>
    </div>

    <!-- Basket heading -->
    <div class="mb-3 flex items-center gap-2 border-b border-gray-700 pb-3">
      <i class="pi pi-shopping-cart text-gray-400" />
      <span class="font-semibold text-gray-300">{{ t('kiosk.basket') }}</span>
    </div>

    <!-- Items list -->
    <div class="flex-1 overflow-y-auto">
      <!-- Empty state -->
      <div v-if="items.length === 0" class="py-8 text-center text-gray-600">
        <i class="pi pi-shopping-cart mb-2 text-3xl" />
        <p class="text-sm">{{ t('kiosk.basket_empty') }}</p>
      </div>

      <!-- Items -->
      <div v-else class="space-y-2">
        <div
          v-for="item in items"
          :key="item.deliveryId"
          class="flex items-center gap-3 rounded-xl p-2 transition-colors"
          :class="
            item.deliveryId === outOfStockDeliveryId
              ? 'bg-red-900/40 ring-1 ring-red-500'
              : 'bg-gray-800/60'
          "
        >
          <!-- Image -->
          <img
            v-if="item.imagePath"
            :src="item.imagePath"
            :alt="item.displayName"
            class="h-10 w-10 flex-shrink-0 rounded-lg object-contain"
          />
          <div
            v-else
            class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-700"
          >
            <i class="pi pi-box text-gray-500" />
          </div>

          <!-- Name + price -->
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-white">{{ item.displayName }}</p>
            <p class="text-xs text-green-400">
              {{ t('common.price_with_currency', { price: item.price * item.quantity }) }}
            </p>
            <p v-if="item.deliveryId === outOfStockDeliveryId" class="text-xs text-red-400">
              {{ t('kiosk.item_out_of_stock_other_buyer') }}
            </p>
          </div>

          <!-- Qty controls -->
          <div class="flex items-center gap-1">
            <button
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-700 text-white transition-colors hover:bg-gray-600 active:scale-95"
              @click="
                item.quantity > 1
                  ? emit('updateQty', item.deliveryId, item.quantity - 1)
                  : emit('remove', item.deliveryId)
              "
            >
              <i :class="item.quantity > 1 ? 'pi pi-minus' : 'pi pi-trash'" class="text-xs" />
            </button>
            <span class="w-6 text-center text-sm font-bold text-white">{{ item.quantity }}</span>
            <button
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-700 text-white transition-colors hover:bg-gray-600 active:scale-95"
              @click="emit('updateQty', item.deliveryId, item.quantity + 1)"
            >
              <i class="pi pi-plus text-xs" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Total -->
    <div class="mt-3 border-t border-gray-700 pt-3">
      <div class="flex items-center justify-between text-lg font-bold">
        <span class="text-gray-300">{{ t('kiosk.total') }}</span>
        <span class="text-green-400">{{ t('common.price_with_currency', { price: total }) }}</span>
      </div>
    </div>

    <!-- Countdown -->
    <div class="mt-2 text-center text-xs" :class="countdownClass">
      {{ t('kiosk.session_expiring', { seconds: countdown }) }}
    </div>

    <!-- Action buttons -->
    <div class="mt-3 flex gap-2">
      <button
        class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gray-700 py-3 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-600 active:scale-95"
        @click="emit('cancel')"
      >
        <i class="pi pi-times" />
        {{ t('kiosk.cancel_basket') }}
      </button>
      <button
        class="flex flex-[2] items-center justify-center gap-2 rounded-xl py-3 text-base font-bold transition-all active:scale-95"
        :class="
          items.length === 0 || checkoutLoading
            ? 'cursor-not-allowed bg-gray-700 text-gray-500'
            : 'bg-green-600 text-white hover:bg-green-500'
        "
        :disabled="items.length === 0 || checkoutLoading"
        @click="emit('checkout')"
      >
        <i v-if="checkoutLoading" class="pi pi-spin pi-spinner" />
        <i v-else class="pi pi-shopping-cart" />
        {{ t('kiosk.checkout') }}
        <span v-if="totalCount > 0" class="rounded-full bg-white/20 px-2 py-0.5 text-sm">
          {{ totalCount }}
        </span>
      </button>
    </div>
  </div>
</template>
