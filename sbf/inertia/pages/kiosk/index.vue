<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import ConfirmDialog from 'primevue/confirmdialog'
import KioskLayout from '~/layouts/KioskLayout.vue'
import KioskKeypad from '~/components/kiosk/KioskKeypad.vue'
import KioskSlideshow from '~/components/kiosk/KioskSlideshow.vue'
import KioskBasket, { type BasketItem } from '~/components/kiosk/KioskBasket.vue'
import KioskCatalog, { type ProductItem } from '~/components/kiosk/KioskCatalog.vue'
import KioskThankYou from '~/components/kiosk/KioskThankYou.vue'
import { useI18n } from '~/composables/use_i18n'

// ── Server-provided props ─────────────────────────────────────────────────────

interface FeaturedProduct {
  id: number
  displayName: string
  imagePath: string | null
  price: number | null
  stockSum: number
  category: { name: string; color: string }
}

const props = defineProps<{
  featuredProducts: FeaturedProduct[]
  allProducts: ProductItem[]
}>()

// ── Composables ───────────────────────────────────────────────────────────────

const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()

// ── App state ─────────────────────────────────────────────────────────────────

type AppState = 'idle' | 'identified'

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

const appState = ref<AppState>('idle')
const customer = ref<CustomerInfo | null>(null)
const keypadLoading = ref(false)

// Personalization overlay (merged client-side onto allProducts)
const favoriteIds = ref<number[]>([])
const recommendedIds = ref<number[]>([])

const personalizedProducts = computed<ProductItem[]>(() => {
  const recommendedRankMap = new Map(recommendedIds.value.map((id, i) => [id, i + 1]))
  return props.allProducts.map((p) => {
    const rank = recommendedRankMap.get(p.id) ?? 0
    return {
      ...p,
      isFavorite: favoriteIds.value.includes(p.id),
      isRecommended: rank > 0 && rank <= 3, // only top-3 get the recommended highlight
      recommendationRank: rank,
    }
  })
})

// ── Basket ────────────────────────────────────────────────────────────────────

const basket = ref<BasketItem[]>([])
const checkoutLoading = ref(false)
const outOfStockDeliveryId = ref<number | null>(null)

// ── Thank-you modal ────────────────────────────────────────────────────────────
const showThankYou = ref(false)
const lastPurchaseItems = ref<BasketItem[]>([])
const lastOrderCount = ref(0)

const basketQtyMap = computed<Map<number, number>>(() => {
  const m = new Map<number, number>()
  for (const item of basket.value) {
    m.set(item.deliveryId, item.quantity)
  }
  return m
})

function addToBasket(product: ProductItem) {
  if (!product.deliveryId) return
  resetIdleTimer()

  const existing = basket.value.find((i) => i.deliveryId === product.deliveryId)
  if (existing) {
    if (existing.quantity >= product.stockSum) {
      toast.add({ severity: 'warn', summary: t('kiosk.max_stock_reached'), life: 2000 })
      return
    }
    existing.quantity++
  } else {
    basket.value.push({
      deliveryId: product.deliveryId,
      displayName: product.displayName,
      imagePath: product.imagePath,
      price: product.price ?? 0,
      quantity: 1,
      maxStock: product.stockSum,
    })
  }

  // Clear any previous out-of-stock highlight
  if (outOfStockDeliveryId.value === product.deliveryId) {
    outOfStockDeliveryId.value = null
  }

  toast.add({ severity: 'success', summary: product.displayName, life: 1200 })
}

function updateQty(deliveryId: number, qty: number) {
  resetIdleTimer()
  const item = basket.value.find((i) => i.deliveryId === deliveryId)
  if (item) item.quantity = qty
}

function removeFromBasket(deliveryId: number) {
  resetIdleTimer()
  basket.value = basket.value.filter((i) => i.deliveryId !== deliveryId)
}

// ── Idle timer (90 seconds) ───────────────────────────────────────────────────

const IDLE_SECONDS = 90
const countdown = ref(IDLE_SECONDS)
let countdownInterval: ReturnType<typeof setInterval> | null = null

function resetIdleTimer() {
  countdown.value = IDLE_SECONDS
}

function startIdleTimer() {
  stopIdleTimer()
  countdown.value = IDLE_SECONDS
  countdownInterval = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      playAlarm()
      resetToIdle()
    }
  }, 1000)
}

function stopIdleTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }
}

function playAlarm() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.value = 0.25
    osc.type = 'sine'
    osc.start()
    setTimeout(() => {
      osc.stop()
      ctx.close()
    }, 1200)
  } catch {
    // AudioContext not available (SSR/test env)
  }
}

// ── Barcode scanner ───────────────────────────────────────────────────────────

// Scanners emit chars then Enter. Buffer collects chars between keydowns.
let barcodeBuffer = ''
let barcodeTimeout: ReturnType<typeof setTimeout> | null = null

function onGlobalKeydown(e: KeyboardEvent) {
  if (appState.value !== 'identified') return

  // Enter = end of scan
  if (e.key === 'Enter' && barcodeBuffer.length > 0) {
    const code = barcodeBuffer
    barcodeBuffer = ''
    if (barcodeTimeout) clearTimeout(barcodeTimeout)
    handleBarcode(code)
    return
  }

  // Accumulate printable chars
  if (e.key.length === 1) {
    barcodeBuffer += e.key
    // Reset buffer if no Enter arrives within 100ms (human typing, not scanner)
    if (barcodeTimeout) clearTimeout(barcodeTimeout)
    barcodeTimeout = setTimeout(() => {
      barcodeBuffer = ''
    }, 100)
  }
}

function handleBarcode(code: string) {
  resetIdleTimer()
  const product = props.allProducts.find((p) => p.barcode === code)
  if (!product) {
    toast.add({ severity: 'warn', summary: t('kiosk.product_not_found'), life: 2500 })
    return
  }
  addToBasket(product)
}

// ── Product refresh ───────────────────────────────────────────────────────────

/**
 * Reload allProducts + featuredProducts from the server in the background.
 * preserveState: true keeps all client-side refs (basket, customer, etc.) intact.
 */
function refreshProducts() {
  router.reload({ only: ['allProducts', 'featuredProducts'], preserveState: true })
}

// ── Customer identification ───────────────────────────────────────────────────

function getCsrfToken(): string {
  const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

async function onKeypadSubmit(keypadId: string) {
  keypadLoading.value = true

  try {
    const res = await fetch(`/kiosk/customer?keypadId=${encodeURIComponent(keypadId)}`, {
      headers: { Accept: 'application/json' },
    })
    const data = await res.json()

    if (!res.ok) {
      toast.add({
        severity: 'error',
        summary: data.error ?? t('messages.kiosk_customer_not_found'),
        life: 3000,
      })
      return
    }

    customer.value = data.customer
    favoriteIds.value = data.favoriteIds
    recommendedIds.value = data.recommendedIds
    appState.value = 'identified'
    startIdleTimer()
    refreshProducts() // fetch fresh stock data for this customer's session
  } catch {
    toast.add({ severity: 'error', summary: t('kiosk.purchase_retry'), life: 3000 })
  } finally {
    keypadLoading.value = false
  }
}

// ── Checkout ──────────────────────────────────────────────────────────────────

function requestCheckout() {
  if (basket.value.length === 0) return
  resetIdleTimer()

  const total = basket.value.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const count = basket.value.reduce((sum, i) => sum + i.quantity, 0)

  confirm.require({
    group: 'kiosk',
    message: t('kiosk.confirm_checkout', { count, total }),
    header: t('kiosk.confirm_checkout_title'),
    icon: 'pi pi-shopping-cart',
    acceptLabel: t('kiosk.checkout'),
    rejectLabel: t('kiosk.cancel_basket'),
    accept: () => submitBasket(),
  })
}

async function submitBasket() {
  if (!customer.value || basket.value.length === 0) return

  checkoutLoading.value = true
  outOfStockDeliveryId.value = null

  try {
    const res = await fetch('/kiosk/purchase-basket', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': getCsrfToken(),
      },
      body: JSON.stringify({
        customerId: customer.value.id,
        items: basket.value.map((i) => ({ deliveryId: i.deliveryId, quantity: i.quantity })),
      }),
    })
    const data = await res.json()

    if (data.ok) {
      // Capture summary before resetting state, then show thank-you modal
      lastPurchaseItems.value = [...basket.value]
      lastOrderCount.value = data.orderCount
      showThankYou.value = true
      refreshProducts() // refresh stock while the thank-you modal is visible
    } else if (data.error === 'out_of_stock') {
      outOfStockDeliveryId.value = data.deliveryId ?? null
      toast.add({
        severity: 'error',
        summary: t('kiosk.item_out_of_stock_other_buyer'),
        life: 4000,
      })
    } else {
      toast.add({ severity: 'error', summary: t('kiosk.purchase_retry'), life: 4000 })
    }
  } catch {
    toast.add({ severity: 'error', summary: t('kiosk.purchase_retry'), life: 4000 })
  } finally {
    checkoutLoading.value = false
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function resetToIdle() {
  stopIdleTimer()
  appState.value = 'idle'
  customer.value = null
  basket.value = []
  favoriteIds.value = []
  recommendedIds.value = []
  outOfStockDeliveryId.value = null
  showThankYou.value = false
  lastPurchaseItems.value = []
  lastOrderCount.value = 0
}

function requestCancel() {
  if (basket.value.length === 0) {
    resetToIdle()
    return
  }
  confirm.require({
    group: 'kiosk',
    message: t('kiosk.cancel_basket') + '?',
    header: t('kiosk.cancel_basket'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('kiosk.cancel_basket'),
    rejectLabel: t('common.back'),
    accept: () => resetToIdle(),
  })
}

// Reset idle timer on any user interaction
watch(appState, (s) => {
  if (s !== 'identified') stopIdleTimer()
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  stopIdleTimer()
  if (barcodeTimeout) clearTimeout(barcodeTimeout)
})
</script>

<template>
  <KioskLayout>
    <Head :title="t('kiosk.title')" />

    <!-- Headless ConfirmDialog — full control over size and touch targets -->
    <ConfirmDialog group="kiosk">
      <template #container="{ message, acceptCallback, rejectCallback }">
        <div
          class="mx-auto w-full max-w-lg overflow-hidden rounded-3xl border border-gray-700 bg-gray-800 shadow-2xl"
          @click.stop
        >
          <!-- Header -->
          <div class="flex items-center gap-5 border-b border-gray-700 px-8 py-7">
            <div
              class="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl"
              :class="message.icon?.includes('exclamation') ? 'bg-red-900/50' : 'bg-green-900/50'"
            >
              <i
                :class="[
                  message.icon,
                  'text-4xl',
                  message.icon?.includes('exclamation') ? 'text-red-400' : 'text-green-400',
                ]"
              />
            </div>
            <h2 class="text-3xl font-bold text-white">{{ message.header }}</h2>
          </div>

          <!-- Message -->
          <div class="px-8 py-7">
            <p class="text-xl leading-relaxed text-gray-300">{{ message.message }}</p>
          </div>

          <!-- Buttons -->
          <div class="flex gap-4 px-8 pb-8">
            <button
              class="flex flex-1 items-center justify-center rounded-2xl bg-gray-700 py-6 text-xl font-semibold text-gray-300 transition-all hover:bg-gray-600 active:scale-95"
              @click="rejectCallback"
            >
              {{ message.rejectLabel }}
            </button>
            <button
              class="flex flex-[2] items-center justify-center rounded-2xl py-6 text-2xl font-bold text-white transition-all active:scale-95"
              :class="
                message.icon?.includes('exclamation')
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-green-600 hover:bg-green-500'
              "
              @click="acceptCallback"
            >
              {{ message.acceptLabel }}
            </button>
          </div>
        </div>
      </template>
    </ConfirmDialog>

    <div class="flex h-screen overflow-hidden">
      <!-- ── LEFT PANEL ─────────────────────────────────────────── -->
      <div class="flex w-5/12 flex-col border-r border-gray-700/50 bg-gray-900">
        <Transition name="panel-swap" mode="out-in">
          <!-- Idle: keypad -->
          <KioskKeypad
            v-if="appState === 'idle'"
            key="keypad"
            :loading="keypadLoading"
            @submit="onKeypadSubmit"
          />

          <!-- Identified: basket -->
          <KioskBasket
            v-else
            key="basket"
            :customer="customer!"
            :items="basket"
            :countdown="countdown"
            :checkout-loading="checkoutLoading"
            :out-of-stock-delivery-id="outOfStockDeliveryId"
            @update-qty="updateQty"
            @remove="removeFromBasket"
            @checkout="requestCheckout"
            @cancel="requestCancel"
          />
        </Transition>
      </div>

      <!-- ── RIGHT PANEL ────────────────────────────────────────── -->
      <div class="flex w-7/12 flex-col bg-gray-900">
        <Transition name="panel-swap" mode="out-in">
          <!-- Idle: product slideshow -->
          <KioskSlideshow v-if="appState === 'idle'" key="slideshow" :products="featuredProducts" />

          <!-- Identified: scrollable catalog -->
          <KioskCatalog
            v-else
            key="catalog"
            :products="personalizedProducts"
            :basket-qty-map="basketQtyMap"
            @add-product="addToBasket"
          />
        </Transition>
      </div>
    </div>

    <!-- ── Thank-you modal — shown after successful checkout ── -->
    <Transition name="fade-scale">
      <KioskThankYou
        v-if="showThankYou && customer"
        :customer="customer"
        :items="lastPurchaseItems"
        :order-count="lastOrderCount"
        @close="resetToIdle"
      />
    </Transition>
  </KioskLayout>
</template>

<style scoped>
.panel-swap-enter-active,
.panel-swap-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.panel-swap-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.panel-swap-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

.fade-scale-enter-active,
.fade-scale-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
