<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
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

    <!-- Product grid -->
    <div
      v-if="filteredProducts.length"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <Card
        v-for="product in visibleProducts"
        :key="product.id"
        class="sbf-card relative flex h-full flex-col overflow-hidden"
        :pt="{
          body: { class: 'flex flex-col flex-1' },
          content: { class: 'flex-1' },
        }"
      >
        <template #header>
          <div
            class="flex h-50 items-center justify-center bg-gray-100 p-2 dark:bg-zinc-800"
            :style="{ borderTop: `3px solid ${product.category.color}` }"
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
        </template>

        <template #title>
          <div class="flex items-start justify-between gap-2">
            <span class="text-base">{{ product.displayName }}</span>
            <button
              @click.stop="toggleFavorite(product.id)"
              class="shrink-0 text-lg"
              :class="
                product.isFavorite
                  ? 'text-yellow-500'
                  : 'text-gray-300 hover:text-yellow-400 dark:text-zinc-600 dark:hover:text-yellow-400'
              "
            >
              <span :class="product.isFavorite ? 'pi pi-star-fill' : 'pi pi-star'" />
            </button>
          </div>
        </template>

        <template #subtitle>
          <div class="flex items-center gap-2">
            <Tag
              :value="product.category.name"
              :style="{ backgroundColor: product.category.color, color: '#fff' }"
              class="text-xs"
            />
            <span class="text-xs text-gray-400">#{{ product.keypadId }}</span>
          </div>
        </template>

        <template #content>
          <p v-if="product.description" class="mb-3 text-sm text-gray-500 dark:text-zinc-400">
            {{ product.description }}
          </p>
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xl font-bold text-gray-900 dark:text-zinc-100">{{
                t('common.price_with_currency', { price: product.price ?? 0 })
              }}</span>
              <span class="ml-2 text-xs text-gray-400 dark:text-zinc-500">{{
                t('common.pieces_in_stock', { count: product.stockSum })
              }}</span>
            </div>
          </div>
        </template>

        <template #footer>
          <Button
            :label="t('common.purchase')"
            icon="pi pi-shopping-cart"
            class="w-full"
            :disabled="!product.deliveryId"
            @click="purchase(product)"
          />
        </template>
      </Card>
    </div>

    <!-- Sentinel for IntersectionObserver -->
    <div v-if="filteredProducts.length" ref="sentinel" class="h-1" />

    <div v-if="!filteredProducts.length" class="py-12 text-center text-gray-500 dark:text-zinc-400">
      <span class="pi pi-inbox mb-4 text-5xl text-gray-300 dark:text-zinc-600" />
      <p class="mt-4">{{ t('shop.no_products') }}</p>
    </div>
  </AppLayout>
</template>
