<script setup lang="ts">
import { onMounted } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { useToast } from 'primevue/usetoast'
import KioskLayout from '~/layouts/KioskLayout.vue'
import KioskKeypad from '~/components/kiosk/KioskKeypad.vue'
import KioskRightPanel, { type PanelState } from '~/components/kiosk/KioskRightPanel.vue'
import { useI18n } from '~/composables/use_i18n'

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

interface ProductItem {
  id: number
  displayName: string
  imagePath: string | null
  price: number | null
  deliveryId: number | null
  stockSum: number
  isFavorite: boolean
  category: { name: string; color: string }
}

const props = defineProps<{
  panelState: PanelState
  featuredProducts: ProductItem[]
  personalizedProducts: ProductItem[]
  customer: CustomerInfo | null
  error: string | null
}>()

const { t } = useI18n()
const toast = useToast()

onMounted(() => {
  // Handle success/error query params from post-purchase redirect
  const url = window.location.href
  if (url.includes('success=1')) {
    toast.add({
      severity: 'success',
      summary: t('kiosk.purchase_success'),
      life: 4000,
    })
  } else if (url.includes('error=out_of_stock')) {
    toast.add({
      severity: 'error',
      summary: t('kiosk.purchase_out_of_stock'),
      life: 4000,
    })
  }
})

function onKeypadSubmit(keypadId: string) {
  router.get('/kiosk', { keypadId }, { preserveState: false })
}
</script>

<template>
  <KioskLayout>
    <Head :title="t('kiosk.title')" />

    <div class="flex h-screen overflow-hidden">
      <!-- Left panel: keypad -->
      <div class="flex w-5/12 flex-col justify-center border-r border-gray-700/50 bg-gray-900">
        <KioskKeypad :customer="customer" :error="error" @submit="onKeypadSubmit" />
      </div>

      <!-- Right panel: featured / personalized products -->
      <div class="w-7/12 overflow-y-auto bg-gray-900">
        <KioskRightPanel
          :state="panelState"
          :featured-products="featuredProducts"
          :personalized-products="personalizedProducts"
          :customer="customer"
          :keypad-id="customer?.keypadId?.toString() ?? ''"
        />
      </div>
    </div>
  </KioskLayout>
</template>
