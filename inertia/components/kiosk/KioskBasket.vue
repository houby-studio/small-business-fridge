<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/use_i18n'

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

export interface BasketItem {
  productId: number
  displayName: string
  imagePath: string | null
  quantity: number
  totalPrice: number
  canIncrement: boolean
}

const props = defineProps<{
  customer: CustomerInfo
  items: BasketItem[]
  countdown: number
  checkoutLoading: boolean
  outOfStockProductId: number | null
}>()

const emit = defineEmits<{
  increment: [productId: number]
  decrement: [productId: number]
  checkout: []
  cancel: []
}>()

const { t } = useI18n()

const total = computed(() => props.items.reduce((sum, i) => sum + i.totalPrice, 0))
const totalCount = computed(() => props.items.reduce((sum, i) => sum + i.quantity, 0))

const countdownClass = computed(() => {
  if (props.countdown <= 15) return 'text-red-400 animate-pulse'
  if (props.countdown <= 30) return 'text-yellow-400'
  return 'text-gray-500'
})
</script>

<template>
  <div class="flex h-full flex-col p-5">
    <!-- Customer header (no logout button — Cancel below does the same) -->
    <div class="mb-4 px-1">
      <h2 class="text-2xl font-bold text-white">{{ customer.displayName }}</h2>
      <p class="text-sm text-gray-500">ID: {{ customer.keypadId }}</p>
    </div>

    <!-- Basket heading -->
    <div class="mb-3 flex items-center gap-2 border-b border-gray-700 pb-3">
      <i class="pi pi-shopping-cart text-gray-400" />
      <span class="text-lg font-semibold text-gray-300">{{ t('kiosk.basket') }}</span>
    </div>

    <!-- Items list -->
    <div class="flex-1 overflow-y-auto">
      <!-- Empty state -->
      <div v-if="items.length === 0" class="py-12 text-center text-gray-600">
        <i class="pi pi-shopping-cart mb-3 text-5xl" />
        <p class="text-base">{{ t('kiosk.basket_empty') }}</p>
      </div>

      <!-- Items -->
      <div v-else class="space-y-3">
        <div
          v-for="item in items"
          :key="item.productId"
          class="flex items-center gap-4 rounded-2xl p-4 transition-colors"
          :class="
            item.productId === outOfStockProductId
              ? 'bg-red-900/40 ring-1 ring-red-500'
              : 'bg-gray-800/60'
          "
        >
          <!-- Image -->
          <img
            v-if="item.imagePath"
            :src="item.imagePath"
            :alt="item.displayName"
            class="h-20 w-20 flex-shrink-0 rounded-xl object-contain"
          />
          <div
            v-else
            class="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-xl bg-gray-700"
          >
            <i class="pi pi-box text-2xl text-gray-500" />
          </div>

          <!-- Name + price -->
          <div class="min-w-0 flex-1">
            <p class="truncate text-lg font-semibold text-white">{{ item.displayName }}</p>
            <p class="text-base text-green-400">
              {{ t('common.price_with_currency', { price: item.totalPrice }) }}
            </p>
            <p v-if="item.productId === outOfStockProductId" class="text-sm text-red-400">
              {{ t('kiosk.item_fifo_only') }}
            </p>
          </div>

          <!-- Qty controls -->
          <div class="flex items-center gap-2">
            <button
              class="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-700 text-white transition-colors hover:bg-gray-600 active:scale-95"
              @click="emit('decrement', item.productId)"
            >
              <i class="pi pi-minus" />
            </button>
            <span class="w-8 text-center text-xl font-bold text-white">{{ item.quantity }}</span>
            <button
              class="flex h-12 w-12 items-center justify-center rounded-xl transition-colors active:scale-95"
              :class="
                !item.canIncrement
                  ? 'cursor-not-allowed bg-gray-800 text-gray-600'
                  : 'bg-gray-700 text-white hover:bg-gray-600'
              "
              :disabled="!item.canIncrement"
              @click="item.canIncrement && emit('increment', item.productId)"
            >
              <i class="pi pi-plus" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Total -->
    <div class="mt-4 border-t border-gray-700 pt-4">
      <div class="flex items-center justify-between text-2xl font-bold">
        <span class="text-gray-300">{{ t('kiosk.total') }}</span>
        <span class="text-green-400">{{ t('common.price_with_currency', { price: total }) }}</span>
      </div>
    </div>

    <!-- Countdown -->
    <div class="mt-2 text-center text-sm" :class="countdownClass">
      {{ t('kiosk.session_expiring', { seconds: countdown }) }}
    </div>

    <!-- Action buttons -->
    <div class="mt-4 flex gap-3">
      <button
        class="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gray-700 py-5 text-lg font-semibold text-gray-300 transition-colors hover:bg-gray-600 active:scale-95"
        @click="emit('cancel')"
      >
        <i class="pi pi-times" />
        {{ t('kiosk.cancel_basket') }}
      </button>
      <button
        class="flex flex-[2] items-center justify-center gap-2 rounded-2xl py-5 text-xl font-bold transition-all active:scale-95"
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
        <span v-if="totalCount > 0" class="rounded-full bg-white/20 px-3 py-0.5 text-base">
          {{ totalCount }}
        </span>
      </button>
    </div>
  </div>
</template>
