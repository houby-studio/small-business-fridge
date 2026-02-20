<script setup lang="ts">
import { computed } from 'vue'
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
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <div class="grid grid-cols-3 gap-3">
      <div
        v-for="product in sortedProducts"
        :key="product.id"
        class="relative cursor-pointer rounded-2xl border transition-all active:scale-95"
        :class="{
          'sbf-card-recommended border-yellow-500/40 bg-yellow-900/10':
            product.isRecommended && !product.isFavorite,
          'sbf-card-favorite border-pink-500/40 bg-pink-900/10':
            product.isFavorite && !product.isRecommended,
          'sbf-card-both border-purple-500/40 bg-purple-900/10':
            product.isRecommended && product.isFavorite,
          'border-gray-700/50 bg-gray-800/60 hover:border-gray-600':
            !product.isRecommended && !product.isFavorite,
          'hover:scale-102': true,
        }"
        :style="{ borderBottom: `3px solid ${product.category.color}` }"
        @click="emit('addProduct', product)"
      >
        <!-- In-basket quantity badge -->
        <div
          v-if="basketQtyMap.get(product.deliveryId ?? -1)"
          class="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white shadow"
        >
          {{ basketQtyMap.get(product.deliveryId ?? -1) }}
        </div>

        <!-- Low-stock badge -->
        <div
          v-if="product.stockSum <= 5"
          class="absolute left-1.5 top-1.5 z-10 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white"
        >
          {{ t('kiosk.low_stock', { count: product.stockSum }) }}
        </div>

        <div class="p-3 text-center">
          <img
            v-if="product.imagePath"
            :src="product.imagePath"
            :alt="product.displayName"
            class="mx-auto mb-2 h-20 w-full object-contain"
          />
          <div
            v-else
            class="mx-auto mb-2 flex h-20 w-full items-center justify-center rounded-lg bg-gray-700"
          >
            <i class="pi pi-box text-2xl text-gray-500" />
          </div>
          <p class="line-clamp-2 text-xs font-semibold leading-tight text-white">
            {{ product.displayName }}
          </p>
          <p class="mt-1 text-sm font-bold text-green-400">
            {{ t('common.price_with_currency', { price: product.price ?? 0 }) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
