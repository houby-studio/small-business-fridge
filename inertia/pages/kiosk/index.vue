<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import ConfirmDialog from 'primevue/confirmdialog'
import KioskLayout from '~/layouts/KioskLayout.vue'
import KioskKeypad from '~/components/kiosk/KioskKeypad.vue'
import KioskSlideshow from '~/components/kiosk/KioskSlideshow.vue'
import KioskBasket, {
  type BasketItem as BasketDisplayItem,
} from '~/components/kiosk/KioskBasket.vue'
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

interface ServerProduct {
  id: number
  displayName: string
  imagePath: string | null
  price: number | null
  deliveryId: number | null
  stockSum: number
  deliveryLots: Array<{
    deliveryId: number
    price: number
    amountLeft: number
    createdAt: string
  }>
  allergens: { id: number; name: string }[]
  isFavorite: boolean
  isRecommended?: boolean
  recommendationRank?: number
  barcode: string | null
  category: { name: string; color: string }
}

const props = defineProps<{
  featuredProducts: FeaturedProduct[]
  allProducts: ServerProduct[]
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

interface MusicTrack {
  id: number
  name: string
  filePath: string
}

interface BasketLine {
  productId: number
  deliveryId: number
  displayName: string
  imagePath: string | null
  price: number
  quantity: number
  maxStock: number
}

const appState = ref<AppState>('idle')
const customer = ref<CustomerInfo | null>(null)
const keypadLoading = ref(false)

// Personalization overlay (merged client-side onto allProducts)
const favoriteIds = ref<number[]>([])
const recommendedIds = ref<number[]>([])
const excludedAllergenIds = ref<number[]>([])
const musicTracks = ref<MusicTrack[]>([])
const backgroundAudio = ref<HTMLAudioElement | null>(null)
const eventTonePlayers = new Map<string, HTMLAudioElement>()
let remainingTrackIds: number[] = []

function refillTrackQueue() {
  remainingTrackIds = musicTracks.value.map((track) => track.id)
}

function stopBackgroundMusic() {
  const audio = backgroundAudio.value
  if (!audio) return
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
}

function playNextTrack() {
  const audio = backgroundAudio.value
  if (!audio || musicTracks.value.length === 0) return

  if (remainingTrackIds.length === 0) {
    refillTrackQueue()
  }

  const nextIndex = Math.floor(Math.random() * remainingTrackIds.length)
  const nextTrackId = remainingTrackIds.splice(nextIndex, 1)[0]
  const nextTrack =
    musicTracks.value.find((track) => track.id === nextTrackId) ?? musicTracks.value[0]

  audio.volume = 0.35
  audio.src = nextTrack.filePath
  audio.currentTime = 0
  void audio.play().catch(() => {
    // Browser can still reject autoplay in constrained environments.
  })
}

function startBackgroundMusic(tracks: MusicTrack[]) {
  musicTracks.value = tracks
  refillTrackQueue()

  if (tracks.length === 0) {
    stopBackgroundMusic()
    return
  }

  playNextTrack()
}

function playEventTone(fileName: string) {
  let player = eventTonePlayers.get(fileName)
  if (!player) {
    player = new Audio(`/keypad/${fileName}`)
    player.preload = 'auto'
    eventTonePlayers.set(fileName, player)
  }

  player.currentTime = 0
  void player.play().catch(() => {
    // Ignore playback failures due to browser autoplay restrictions.
  })
}

function playLoginTone(type: 'success' | 'error') {
  playEventTone(type === 'success' ? 'login-success.wav' : 'login-error.wav')
}

// ── Basket ────────────────────────────────────────────────────────────────────

const basket = ref<BasketLine[]>([])
const checkoutLoading = ref(false)
const outOfStockDeliveryId = ref<number | null>(null)

// ── Thank-you modal ────────────────────────────────────────────────────────────
const showThankYou = ref(false)
const lastPurchaseItems = ref<BasketLine[]>([])
const lastOrderCount = ref(0)

const basketQtyMap = computed<Map<number, number>>(() => {
  const m = new Map<number, number>()
  for (const item of basket.value) {
    m.set(item.productId, (m.get(item.productId) ?? 0) + item.quantity)
  }
  return m
})

const basketItems = computed<BasketDisplayItem[]>(() => {
  const grouped = new Map<number, BasketDisplayItem>()

  for (const line of basket.value) {
    const existing = grouped.get(line.productId)
    if (existing) {
      existing.quantity += line.quantity
      existing.totalPrice += line.price * line.quantity
      continue
    }

    grouped.set(line.productId, {
      productId: line.productId,
      displayName: line.displayName,
      imagePath: line.imagePath,
      quantity: line.quantity,
      totalPrice: line.price * line.quantity,
      canIncrement:
        (personalizedProducts.value.find((p) => p.id === line.productId)?.remainingStock ?? 0) > 0,
    })
  }

  return [...grouped.values()]
})

const outOfStockProductId = computed<number | null>(() => {
  if (!outOfStockDeliveryId.value) {
    return null
  }
  const line = basket.value.find((item) => item.deliveryId === outOfStockDeliveryId.value)
  return line?.productId ?? null
})

function getReservedQty(deliveryId: number): number {
  return basket.value
    .filter((item) => item.deliveryId === deliveryId)
    .reduce((sum, item) => sum + item.quantity, 0)
}

function getNextAvailableLot(product: ServerProduct) {
  return (
    product.deliveryLots.find((lot) => lot.amountLeft - getReservedQty(lot.deliveryId) > 0) ?? null
  )
}

function getRemainingStock(product: ServerProduct): number {
  return product.deliveryLots.reduce(
    (sum, lot) => sum + Math.max(lot.amountLeft - getReservedQty(lot.deliveryId), 0),
    0
  )
}

const personalizedProducts = computed<ProductItem[]>(() => {
  const recommendedRankMap = new Map(recommendedIds.value.map((id, i) => [id, i + 1]))

  return props.allProducts
    .filter((p) =>
      excludedAllergenIds.value.length === 0
        ? true
        : !p.allergens.some((a) => excludedAllergenIds.value.includes(a.id))
    )
    .map((p) => {
      const rank = recommendedRankMap.get(p.id) ?? 0
      const nextLot = getNextAvailableLot(p)
      return {
        ...p,
        price: nextLot?.price ?? null,
        deliveryId: nextLot?.deliveryId ?? null,
        remainingStock: getRemainingStock(p),
        isFavorite: favoriteIds.value.includes(p.id),
        isRecommended: rank > 0 && rank <= 3,
        recommendationRank: rank,
      }
    })
})

function addToBasket(product: ProductItem) {
  resetIdleTimer()

  const source = props.allProducts.find((p) => p.id === product.id)
  if (!source) {
    return
  }

  const nextLot = getNextAvailableLot(source)
  if (!nextLot) {
    toast.add({ severity: 'warn', summary: t('kiosk.max_stock_reached'), life: 2000 })
    return
  }

  const existing = basket.value.find((i) => i.deliveryId === nextLot.deliveryId)
  if (existing) {
    if (existing.quantity >= existing.maxStock) {
      toast.add({ severity: 'warn', summary: t('kiosk.max_stock_reached'), life: 2000 })
      return
    }
    existing.quantity++
  } else {
    basket.value.push({
      productId: product.id,
      deliveryId: nextLot.deliveryId,
      displayName: product.displayName,
      imagePath: product.imagePath,
      price: nextLot.price,
      quantity: 1,
      maxStock: nextLot.amountLeft,
    })
  }

  // Clear any previous out-of-stock highlight
  if (outOfStockDeliveryId.value === nextLot.deliveryId) {
    outOfStockDeliveryId.value = null
  }
}

function incrementProduct(productId: number) {
  const product = personalizedProducts.value.find((p) => p.id === productId)
  if (!product) {
    return
  }
  addToBasket(product)
}

function decrementProduct(productId: number) {
  resetIdleTimer()
  const lastIndex = [...basket.value.keys()]
    .reverse()
    .find((index) => basket.value[index].productId === productId)
  if (lastIndex === undefined) {
    return
  }

  const line = basket.value[lastIndex]
  if (line.quantity > 1) {
    line.quantity--
  } else {
    basket.value.splice(lastIndex, 1)
  }
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
    // AudioContext not available (test env / restricted browser context)
  }
}

// ── Barcode scanner ───────────────────────────────────────────────────────────

// Scanners emit chars then Enter. Buffer collects chars between keydowns.
let barcodeBuffer = ''
let barcodeTimeout: ReturnType<typeof setTimeout> | null = null

function onGlobalKeydown(e: KeyboardEvent) {
  if (appState.value !== 'identified') return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  // Enter = end of scan
  if (e.key === 'Enter' && barcodeBuffer.length > 0) {
    e.preventDefault()
    const code = barcodeBuffer
    barcodeBuffer = ''
    if (barcodeTimeout) clearTimeout(barcodeTimeout)
    handleBarcode(code)
    return
  }

  // Accumulate printable chars
  if (e.key.length === 1) {
    e.preventDefault()
    barcodeBuffer += e.key
    // Keep buffer briefly for scanner bursts while still allowing slower typing + Enter.
    if (barcodeTimeout) clearTimeout(barcodeTimeout)
    barcodeTimeout = setTimeout(() => {
      barcodeBuffer = ''
    }, 2000)
  }
}

function handleBarcode(code: string) {
  resetIdleTimer()
  const product = personalizedProducts.value.find((p) => p.barcode === code)
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
  router.reload({ only: ['allProducts', 'featuredProducts'] })
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

    if (data.action === 'logout') {
      window.location.assign('/logout')
      return
    }

    if (data.action === 'easter_egg') {
      toast.add({
        severity: 'info',
        summary: data.message ?? t('kiosk.easter_egg_666'),
        life: 3500,
      })
      return
    }

    if (!res.ok) {
      playLoginTone('error')
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
    excludedAllergenIds.value = data.excludedAllergenIds ?? []
    startBackgroundMusic(data.musicTracks ?? [])
    playLoginTone('success')
    appState.value = 'identified'
    startIdleTimer()
    refreshProducts() // fetch fresh stock data for this customer's session
  } catch {
    playLoginTone('error')
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
    acceptLabel: t('kiosk.complete_purchase'),
    rejectLabel: t('kiosk.continue_shopping'),
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
      playEventTone('purchase-confirmed.wav')
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
    } else if (data.error === 'fifo_violation') {
      outOfStockDeliveryId.value = null
      toast.add({
        severity: 'error',
        summary: t('kiosk.item_fifo_only'),
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
  confirm.close()
  stopIdleTimer()
  appState.value = 'idle'
  customer.value = null
  basket.value = []
  favoriteIds.value = []
  recommendedIds.value = []
  musicTracks.value = []
  remainingTrackIds = []
  stopBackgroundMusic()
  outOfStockDeliveryId.value = null
  showThankYou.value = false
  lastPurchaseItems.value = []
  lastOrderCount.value = 0
}

function cancelPurchaseSession() {
  playEventTone('purchase-cancelled.wav')
  resetToIdle()
}

function requestCancel() {
  if (basket.value.length === 0) {
    cancelPurchaseSession()
    return
  }
  confirm.require({
    group: 'kiosk',
    message: t('kiosk.cancel_purchase_message'),
    header: t('kiosk.cancel_purchase'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('kiosk.cancel_purchase'),
    rejectLabel: t('kiosk.continue_shopping'),
    accept: () => cancelPurchaseSession(),
  })
}

// Reset idle timer on any user interaction
watch(appState, (s) => {
  if (s !== 'identified') stopIdleTimer()
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown)
  // Pre-load event tone files so kiosk feedback remains immediate.
  for (const fileName of [
    'login-success.wav',
    'login-error.wav',
    'purchase-confirmed.wav',
    'purchase-cancelled.wav',
  ]) {
    const player = new Audio(`/keypad/${fileName}`)
    player.preload = 'auto'
    eventTonePlayers.set(fileName, player)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  stopIdleTimer()
  stopBackgroundMusic()
  for (const player of eventTonePlayers.values()) {
    player.pause()
  }
  eventTonePlayers.clear()
  if (barcodeTimeout) clearTimeout(barcodeTimeout)
})
</script>

<template>
  <KioskLayout>
    <Head :title="t('kiosk.title')" />
    <audio ref="backgroundAudio" class="hidden" @ended="playNextTrack" />

    <!-- Headless ConfirmDialog — full control over size and touch targets -->
    <ConfirmDialog group="kiosk">
      <template #container="{ message, acceptCallback, rejectCallback }">
        <div
          class="mx-auto w-full max-w-lg overflow-hidden rounded-3xl border border-gray-700 bg-gray-800 shadow-2xl"
          style="min-width: 40vw"
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
            :items="basketItems"
            :countdown="countdown"
            :checkout-loading="checkoutLoading"
            :out-of-stock-product-id="outOfStockProductId"
            @increment="incrementProduct"
            @decrement="decrementProduct"
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
