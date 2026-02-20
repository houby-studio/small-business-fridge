<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from '~/composables/use_i18n'

interface ProductItem {
  id: number
  displayName: string
  imagePath: string | null
  price: number | null
  stockSum: number
  category: { name: string; color: string }
}

const props = defineProps<{
  products: ProductItem[]
}>()

const { t } = useI18n()
const currentIndex = ref(0)
const visible = ref(true)
let intervalId: ReturnType<typeof setInterval> | null = null

const current = computed(() => props.products[currentIndex.value] ?? null)

function advance() {
  if (props.products.length <= 1) return
  // Fade out, swap, fade in
  visible.value = false
  setTimeout(() => {
    currentIndex.value = (currentIndex.value + 1) % props.products.length
    visible.value = true
  }, 400)
}

onMounted(() => {
  if (props.products.length > 1) {
    intervalId = setInterval(advance, 4500)
  }
})

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center p-10">
    <!-- Empty state -->
    <div v-if="products.length === 0" class="text-center">
      <i class="pi pi-box mb-6 text-8xl text-gray-600" />
      <h2 class="text-3xl font-bold text-white">{{ t('kiosk.idle_welcome') }}</h2>
    </div>

    <!-- Product slide -->
    <template v-else-if="current">
      <div
        class="flex w-full max-w-md flex-col items-center transition-opacity duration-300"
        :class="visible ? 'opacity-100' : 'opacity-0'"
      >
        <!-- Category color accent -->
        <div
          class="mb-6 h-1 w-24 rounded-full"
          :style="{ backgroundColor: current.category.color }"
        />

        <!-- Product image -->
        <div class="relative mb-8 flex h-64 w-full items-center justify-center">
          <img
            v-if="current.imagePath"
            :src="current.imagePath"
            :alt="current.displayName"
            class="h-full w-full object-contain drop-shadow-2xl"
          />
          <div v-else class="flex h-full w-full items-center justify-center">
            <i class="pi pi-box text-8xl text-gray-600" />
          </div>

          <!-- Low-stock badge -->
          <div
            v-if="current.stockSum <= 5"
            class="absolute right-0 top-0 rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white shadow-lg"
          >
            {{ t('kiosk.low_stock', { count: current.stockSum }) }}
          </div>
        </div>

        <!-- Product info -->
        <h2 class="mb-3 text-center text-3xl font-bold text-white">
          {{ current.displayName }}
        </h2>
        <div class="text-4xl font-bold text-green-400">
          {{ t('common.price_with_currency', { price: current.price ?? 0 }) }}
        </div>
        <div class="mt-2 text-sm text-gray-500">
          {{ t('common.pieces_in_stock', { count: current.stockSum }) }}
        </div>
      </div>

      <!-- Dot navigation -->
      <div v-if="products.length > 1" class="mt-8 flex gap-2">
        <div
          v-for="(_, i) in products"
          :key="i"
          class="h-2 rounded-full transition-all duration-300"
          :class="i === currentIndex ? 'w-6 bg-white' : 'w-2 bg-gray-600'"
        />
      </div>
    </template>
  </div>
</template>
