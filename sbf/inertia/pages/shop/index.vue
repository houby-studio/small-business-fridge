<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import InputText from 'primevue/inputtext'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'

interface ShopProduct {
  id: number
  keypadId: number
  displayName: string
  description: string | null
  imagePath: string | null
  category: { id: number; name: string; color: string }
  stockSum: number
  price: number | null
  deliveryId: number | null
  isFavorite: boolean
}

interface ShopCategory {
  id: number
  name: string
  color: string
}

const props = defineProps<{
  products: ShopProduct[]
  categories: ShopCategory[]
  filters: { category: number | null }
  recommendations: ShopProduct[]
}>()

const confirm = useConfirm()
const { t } = useI18n()

const INITIAL_COUNT = 48
const PAGE_SIZE = 24

const search = ref('')
const selectedCategory = ref<number | null>(props.filters.category)
const showFavoritesOnly = ref(false)
const visibleCount = ref(INITIAL_COUNT)
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const categoryOptions = computed(() => [
  { label: t('common.all'), value: null },
  ...props.categories.map((c) => ({ label: c.name, value: c.id })),
])

const filteredProducts = computed(() => {
  return props.products.filter((p) => {
    if (selectedCategory.value && p.category.id !== selectedCategory.value) return false
    if (showFavoritesOnly.value && !p.isFavorite) return false
    if (search.value) {
      const s = search.value.toLowerCase()
      if (
        !p.displayName.toLowerCase().includes(s) &&
        !p.keypadId.toString().includes(s) &&
        !p.description?.toLowerCase().includes(s)
      ) {
        return false
      }
    }
    return true
  })
})

const visibleProducts = computed(() => filteredProducts.value.slice(0, visibleCount.value))

const hasMore = computed(() => visibleCount.value < filteredProducts.value.length)

function setupObserver() {
  observer?.disconnect()
  if (!sentinel.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && hasMore.value) {
        visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filteredProducts.value.length)
      }
    },
    { rootMargin: '300px' }
  )
  observer.observe(sentinel.value)
}

// Reset visible count and re-observe when filters change
watch(filteredProducts, () => {
  visibleCount.value = INITIAL_COUNT
  nextTick(setupObserver)
})

onMounted(setupObserver)
onUnmounted(() => observer?.disconnect())

function purchase(product: ShopProduct) {
  confirm.require({
    message: t('shop.confirm_message', { name: product.displayName, price: product.price ?? 0 }),
    header: t('shop.confirm_title'),
    icon: 'pi pi-shopping-cart',
    acceptLabel: t('shop.confirm_accept'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      router.post('/shop/purchase', { deliveryId: product.deliveryId })
    },
  })
}

function toggleFavorite(productId: number) {
  router.post(`/profile/favorites/${productId}`, {}, { preserveScroll: true })
}

function nameClass(name: string): string {
  if (name.length > 40) return 'text-sm leading-snug'
  if (name.length > 22) return 'text-base leading-snug'
  return 'text-lg leading-tight'
}
</script>

<template>
  <AppLayout>
    <Head :title="t('shop.title')" />
    <ConfirmDialog />

    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">{{ t('shop.title') }}</h1>
      <div class="flex flex-wrap items-center gap-3">
        <InputText v-model="search" :placeholder="t('common.search') + '...'" class="w-48" />
        <Button
          :icon="showFavoritesOnly ? 'pi pi-star-fill' : 'pi pi-star'"
          :severity="showFavoritesOnly ? 'warn' : 'secondary'"
          :outlined="!showFavoritesOnly"
          size="small"
          @click="showFavoritesOnly = !showFavoritesOnly"
          :aria-label="t('shop.favorite')"
        />
      </div>
    </div>

    <!-- Category filter -->
    <div class="mb-6">
      <SelectButton
        v-model="selectedCategory"
        :options="categoryOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
      />
    </div>

    <!-- For you section -->
    <div v-if="recommendations.length > 0 && !search" class="mb-8">
      <h2
        class="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-700 dark:text-zinc-300"
      >
        <span class="pi pi-sparkles text-yellow-500" />
        {{ t('shop.forYou') }}
      </h2>
      <div class="flex gap-3 overflow-x-auto pb-2" style="scrollbar-width: none">
        <div
          v-for="product in recommendations"
          :key="product.id"
          class="sbf-card relative w-44 shrink-0 rounded-xl"
        >
          <div
            class="relative flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900 cursor-pointer"
            @click="purchase(product)"
          >
            <div class="relative">
              <div
                class="flex h-32 items-center justify-center bg-gray-100 p-2 dark:bg-zinc-800"
                :style="{ borderBottom: `3px solid ${product.category.color}` }"
              >
                <img
                  v-if="product.imagePath"
                  :src="product.imagePath"
                  :alt="product.displayName"
                  class="h-full w-full object-contain"
                  loading="lazy"
                />
                <span v-else class="pi pi-image text-3xl text-gray-300" />
              </div>
            </div>
            <div class="flex flex-1 flex-col px-3 pb-3 pt-2">
              <span
                class="mb-1 line-clamp-2 text-sm font-semibold text-gray-900 dark:text-zinc-100"
              >
                {{ product.displayName }}
              </span>
              <div class="mt-auto">
                <span class="text-base font-bold text-gray-900 dark:text-zinc-100">
                  {{ t('common.price_with_currency', { price: product.price ?? 0 }) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Product grid -->
    <div
      v-if="filteredProducts.length"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <div
        v-for="product in visibleProducts"
        :key="product.id"
        class="sbf-card relative h-full rounded-xl"
        :class="{ 'sbf-card-favorite': product.isFavorite }"
      >
        <!-- Card content -->
        <div
          class="relative flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-900"
        >
          <!-- Image area + badge straddling the image/body boundary -->
          <div class="relative">
            <div
              class="sbf-img-zoom flex h-48 items-center justify-center bg-gray-100 p-2 dark:bg-zinc-800"
              :style="{ borderBottom: `4px solid ${product.category.color}` }"
            >
              <img
                v-if="product.imagePath"
                :src="product.imagePath"
                :alt="product.displayName"
                class="h-full w-full object-contain"
                loading="lazy"
              />
              <span v-else class="pi pi-image text-4xl text-gray-300" />
            </div>
            <!-- Badge centered on the image/body border line (bottom-px = border center) -->
            <div class="absolute bottom-0.5 left-4 z-10 translate-y-1/2">
              <span
                class="sbf-category-badge inline-block px-4 py-1.5 text-xs font-semibold text-white"
                :style="{ backgroundColor: product.category.color }"
              >
                {{ product.category.name }}
              </span>
            </div>
          </div>

          <!-- Card body (pt accommodates the half-badge that extends into this area) -->
          <div class="flex flex-1 flex-col px-4 pb-4 pt-5">
            <!-- Name + favorite -->
            <div class="mb-2 flex items-start justify-between gap-2">
              <span
                :class="[
                  'font-semibold text-gray-900 dark:text-zinc-100',
                  nameClass(product.displayName),
                ]"
              >
                {{ product.displayName }}
              </span>
              <button
                @click.stop="toggleFavorite(product.id)"
                class="mt-0.5 shrink-0 text-lg"
                :class="
                  product.isFavorite
                    ? 'text-yellow-500'
                    : 'text-gray-300 hover:text-yellow-400 dark:text-zinc-600 dark:hover:text-yellow-400'
                "
                :aria-label="t('shop.favorite')"
              >
                <span :class="product.isFavorite ? 'pi pi-star-fill' : 'pi pi-star'" />
              </button>
            </div>

            <!-- Description with flex spacer to push price/button to bottom -->
            <div class="flex-1">
              <p v-if="product.description" class="text-sm text-gray-500 dark:text-zinc-400">
                {{ product.description }}
              </p>
            </div>

            <!-- Price + stock (pinned above button) -->
            <div class="mb-3 mt-3 flex items-center justify-between">
              <span class="text-xl font-bold text-gray-900 dark:text-zinc-100">{{
                t('common.price_with_currency', { price: product.price ?? 0 })
              }}</span>
              <div class="flex items-center gap-1.5">
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  :class="{
                    'bg-green-500': product.stockSum >= 5,
                    'sbf-stock-low bg-red-500': product.stockSum > 0 && product.stockSum < 5,
                    'bg-gray-400 dark:bg-zinc-600': product.stockSum === 0,
                  }"
                />
                <span class="text-xs text-gray-400 dark:text-zinc-500">{{
                  t('common.pieces_in_stock', { count: product.stockSum })
                }}</span>
              </div>
            </div>

            <!-- Buy button -->
            <Button
              :label="t('common.purchase')"
              icon="pi pi-shopping-cart"
              class="w-full"
              :disabled="!product.deliveryId"
              @click="purchase(product)"
            />
          </div>
        </div>
        <!-- /inner card -->
      </div>
    </div>

    <!-- Sentinel for IntersectionObserver -->
    <div v-if="filteredProducts.length" ref="sentinel" class="h-1" />

    <div v-if="!filteredProducts.length" class="py-12 text-center text-gray-500 dark:text-zinc-400">
      <span class="pi pi-inbox mb-4 block text-5xl text-gray-300 dark:text-zinc-600" />
      <p class="mt-4">{{ t('shop.no_products') }}</p>
    </div>
  </AppLayout>
</template>
