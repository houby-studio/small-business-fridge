<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/use_i18n'

export interface ProductItem {
  id: number
  displayName: string
  imagePath: string | null
  price: number | null
  deliveryId: number | null
  stockSum: number
  isFavorite: boolean
  isRecommended: boolean
  recommendationRank: number
  barcode: string | null
  category: { name: string; color: string }
}

const props = defineProps<{
  products: ProductItem[]
  basketQtyMap: Map<number, number>
}>()

const emit = defineEmits<{
  addProduct: [product: ProductItem]
}>()

const { t } = useI18n()

const filterCategory = ref<string | null>(null)

/** Unique categories derived from product list */
const categories = computed(() => {
  const seen = new Set<string>()
  const cats: Array<{ name: string; color: string }> = []
  for (const p of props.products) {
    if (!seen.has(p.category.name)) {
      seen.add(p.category.name)
      cats.push(p.category)
    }
  }
  return cats
})

/** Sort: recommended+favorite → recommended → favorite → rest; then alphabetical */
const sortedProducts = computed(() => {
  return [...props.products].sort((a, b) => {
    const rankA = a.isRecommended && a.isFavorite ? 0 : a.isRecommended ? 1 : a.isFavorite ? 2 : 3
    const rankB = b.isRecommended && b.isFavorite ? 0 : b.isRecommended ? 1 : b.isFavorite ? 2 : 3
    if (rankA !== rankB) return rankA - rankB
    if (a.isRecommended && b.isRecommended) return a.recommendationRank - b.recommendationRank
    return a.displayName.localeCompare(b.displayName, 'cs')
  })
})

const filteredProducts = computed(() => {
  if (!filterCategory.value) return sortedProducts.value
  return sortedProducts.value.filter((p) => p.category.name === filterCategory.value)
})

function glowStyle(product: ProductItem): Record<string, string> {
  if (product.isRecommended && product.isFavorite) {
    return { boxShadow: '0 0 28px rgba(168,85,247,0.4)' } // purple — best of both
  }
  if (product.isFavorite) {
    return { boxShadow: '0 0 28px rgba(234,179,8,0.4)' } // gold — favorites only
  }
  if (product.isRecommended) {
    return { boxShadow: '0 0 28px rgba(59,130,246,0.4)' } // blue — recommended only
  }
  return {}
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Category filter row -->
    <div
      class="flex flex-shrink-0 gap-2 overflow-x-auto border-b border-gray-700/50 px-4 py-3"
      style="scrollbar-width: none"
    >
      <button
        class="flex-shrink-0 rounded-full px-5 py-2 text-base font-semibold transition-all"
        :class="
          !filterCategory ? 'bg-white text-gray-900' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        "
        @click="filterCategory = null"
      >
        {{ t('kiosk.all_categories') }}
      </button>
      <button
        v-for="cat in categories"
        :key="cat.name"
        class="flex-shrink-0 rounded-full px-5 py-2 text-base font-semibold transition-all"
        :class="
          filterCategory === cat.name ? 'text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        "
        :style="filterCategory === cat.name ? { backgroundColor: cat.color } : {}"
        @click="filterCategory = filterCategory === cat.name ? null : cat.name"
      >
        {{ cat.name }}
      </button>
    </div>

    <!-- Product grid -->
    <div class="flex-1 overflow-y-auto p-4">
      <div class="grid grid-cols-3 gap-3">
        <div
          v-for="product in filteredProducts"
          :key="product.id"
          class="relative flex cursor-pointer flex-col rounded-2xl border transition-all active:scale-95"
          :class="
            product.isRecommended && product.isFavorite
              ? 'sbf-card-both border-purple-500/50 bg-purple-900/10'
              : product.isFavorite
                ? 'sbf-card-favorite border-pink-500/50 bg-pink-900/10'
                : product.isRecommended
                  ? 'sbf-card-recommended border-blue-500/50 bg-blue-900/10'
                  : 'border-gray-700/50 bg-gray-800/60 hover:border-gray-600'
          "
          :style="{
            borderBottom: `3px solid ${product.category.color}`,
            ...glowStyle(product),
          }"
          @click="emit('addProduct', product)"
        >
          <!-- In-basket quantity badge -->
          <div
            v-if="basketQtyMap.get(product.deliveryId ?? -1)"
            class="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white shadow-lg"
          >
            {{ basketQtyMap.get(product.deliveryId ?? -1) }}
          </div>

          <!-- Product name at top -->
          <p
            class="line-clamp-2 px-3 pt-4 text-center text-sm font-semibold leading-tight text-white"
          >
            {{ product.displayName }}
          </p>

          <!-- Product image in middle -->
          <div class="flex flex-1 items-center justify-center px-3 py-4">
            <img
              v-if="product.imagePath"
              :src="product.imagePath"
              :alt="product.displayName"
              class="h-32 w-full object-contain"
            />
            <div v-else class="flex h-32 w-full items-center justify-center rounded-xl bg-gray-700">
              <i class="pi pi-box text-4xl text-gray-500" />
            </div>
          </div>

          <!-- Price + stock at bottom -->
          <div class="pb-4 text-center">
            <p class="text-lg font-bold text-green-400">
              {{ t('common.price_with_currency', { price: product.price ?? 0 }) }}
            </p>
            <p class="text-xs text-gray-500">
              {{ t('common.pieces_in_stock', { count: product.stockSum }) }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
