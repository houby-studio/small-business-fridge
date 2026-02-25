<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '~/composables/use_i18n'

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

interface SummaryItem {
  deliveryId: number
  displayName: string
  imagePath: string | null
  price: number
  quantity: number
}

const props = defineProps<{
  customer: CustomerInfo
  items: SummaryItem[]
  orderCount: number
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

const DURATION = 5
const secondsLeft = ref(DURATION)
let timer: ReturnType<typeof setInterval> | null = null

const total = computed(() => props.items.reduce((sum, i) => sum + i.price * i.quantity, 0))
const progressWidth = computed(() => `${(secondsLeft.value / DURATION) * 100}%`)

onMounted(() => {
  timer = setInterval(() => {
    secondsLeft.value--
    if (secondsLeft.value <= 0) {
      emit('close')
    }
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
    @click="emit('close')"
  >
    <div
      class="relative mx-8 w-full max-w-2xl overflow-hidden rounded-3xl border border-green-500/30 bg-gray-900 shadow-2xl shadow-green-900/20"
      @click.stop
    >
      <!-- Countdown progress bar -->
      <div class="absolute inset-x-0 top-0 h-1.5 bg-gray-800">
        <div
          class="h-full bg-green-500 transition-[width] duration-1000 ease-linear"
          :style="{ width: progressWidth }"
        />
      </div>

      <div class="p-10 pt-12">
        <!-- Success header -->
        <div class="mb-8 text-center">
          <div
            class="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full border border-green-500/50 bg-green-500/20"
          >
            <i class="pi pi-check text-5xl text-green-400" />
          </div>
          <h1 class="mb-2 text-4xl font-bold text-white">
            {{ t('kiosk.thank_you', { name: customer.displayName }) }}
          </h1>
          <p class="text-xl text-gray-400">{{ t('kiosk.purchase_done') }}</p>
        </div>

        <!-- Order items -->
        <div class="mb-6 max-h-64 space-y-3 overflow-y-auto">
          <div
            v-for="item in items"
            :key="item.deliveryId"
            class="flex items-center gap-4 rounded-2xl bg-gray-800 p-4"
          >
            <img
              v-if="item.imagePath"
              :src="item.imagePath"
              :alt="item.displayName"
              class="h-14 w-14 flex-shrink-0 rounded-xl object-contain"
            />
            <div
              v-else
              class="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-gray-700"
            >
              <i class="pi pi-box text-xl text-gray-500" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-lg font-semibold text-white">{{ item.displayName }}</p>
              <p class="text-sm text-gray-400">
                {{ t('common.price_with_currency', { price: item.price }) }} × {{ item.quantity }}
              </p>
            </div>
            <p class="flex-shrink-0 text-xl font-bold text-green-400">
              {{ t('common.price_with_currency', { price: item.price * item.quantity }) }}
            </p>
          </div>
        </div>

        <!-- Total -->
        <div class="flex items-center justify-between border-t border-gray-700 pt-6">
          <span class="text-2xl font-bold text-gray-300">{{ t('kiosk.total') }}</span>
          <span class="text-3xl font-bold text-green-400">
            {{ t('common.price_with_currency', { price: total }) }}
          </span>
        </div>

        <!-- Dismiss hint -->
        <p class="mt-4 text-center text-sm text-gray-600">{{ secondsLeft }}s</p>
      </div>
    </div>
  </div>
</template>
