<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
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
let intervalId: ReturnType<typeof setInterval> | null = null

function advance() {
  if (props.products.length <= 1) return
  currentIndex.value = (currentIndex.value + 1) % props.products.length
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
  <div class="relative flex h-full flex-col items-center justify-center p-10">
    <!-- Empty state -->
    <div v-if="products.length === 0" class="text-center">
      <i class="pi pi-box mb-6 text-8xl text-gray-600" />
      <h2 class="text-3xl font-bold text-white">{{ t('kiosk.idle_welcome') }}</h2>
    </div>

    <!-- Product slide — fixed structure so dots never shift -->
    <template v-else>
      <Transition name="slide-lr" mode="out-in">
        <div :key="currentIndex" class="flex w-full max-w-md flex-col items-center">
          <!-- Image area: fixed height, image always centered here -->
          <div class="flex h-80 w-full items-center justify-center">
            <img
              v-if="products[currentIndex].imagePath"
              :src="products[currentIndex].imagePath"
              :alt="products[currentIndex].displayName"
              class="h-full w-full object-contain drop-shadow-2xl"
            />
            <div v-else class="flex h-full w-full items-center justify-center">
              <i class="pi pi-box text-8xl text-gray-600" />
            </div>
          </div>

          <!-- Text area: fixed height so dots don't drift -->
          <div class="mt-8 flex h-36 w-full flex-col items-center justify-start text-center">
            <h2 class="line-clamp-2 text-3xl font-bold leading-tight text-white">
              {{ products[currentIndex].displayName }}
            </h2>
            <div class="mt-3 text-4xl font-bold text-green-400">
              {{ t('common.price_with_currency', { price: products[currentIndex].price ?? 0 }) }}
            </div>
            <div class="mt-1 text-sm text-gray-500">
              {{ t('common.pieces_in_stock', { count: products[currentIndex].stockSum }) }}
            </div>
          </div>
        </div>
      </Transition>

      <!-- Dot navigation: absolute at bottom so it never moves -->
      <div v-if="products.length > 1" class="absolute bottom-10 flex gap-2">
        <div
          v-for="(p, i) in products"
          :key="i"
          class="h-2 rounded-full transition-all duration-500"
          :class="i === currentIndex ? 'w-8' : 'w-2 bg-gray-600'"
          :style="i === currentIndex ? { backgroundColor: p.category.color } : {}"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.slide-lr-enter-active,
.slide-lr-leave-active {
  transition:
    opacity 0.35s ease,
    transform 0.35s ease;
}
.slide-lr-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.slide-lr-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}
</style>
