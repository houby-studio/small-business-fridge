<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Head } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import ConfirmDialog from 'primevue/confirmdialog'
import KioskLayout from '~/layouts/KioskLayout.vue'
import KioskKeypad from '~/components/kiosk/KioskKeypad.vue'
import KioskSlideshow from '~/components/kiosk/KioskSlideshow.vue'
import KioskBasket, { type BasketItem } from '~/components/kiosk/KioskBasket.vue'
import KioskCatalog, { type ProductItem } from '~/components/kiosk/KioskCatalog.vue'
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
  return props.allProducts.map((p) => ({
    ...p,
    isFavorite: favoriteIds.value.includes(p.id),
    isRecommended: recommendedRankMap.has(p.id),
    recommendationRank: recommendedRankMap.get(p.id) ?? 0,
  }))
})

// ── Basket ────────────────────────────────────────────────────────────────────

const basket = ref<BasketItem[]>([])
const checkoutLoading = ref(false)
const outOfStockDeliveryId = ref<number | null>(null)

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
      toast.add({
        severity: 'success',
        summary: t('kiosk.checkout_success', { count: data.orderCount }),
        life: 2500,
      })
      setTimeout(() => resetToIdle(), 2500)
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
}

function requestCancel() {
  if (basket.value.length === 0) {
    resetToIdle()
    return
  }
  confirm.require({
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
    <ConfirmDialog />

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
</style>
