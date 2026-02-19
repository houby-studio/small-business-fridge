<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import KioskLayout from '~/layouts/KioskLayout.vue'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()

const keypadInput = ref('')

function pressKey(key: string) {
  if (key === 'clear') {
    keypadInput.value = ''
  } else if (key === 'back') {
    keypadInput.value = keypadInput.value.slice(0, -1)
  } else if (key === 'enter') {
    if (keypadInput.value) {
      router.get('/kiosk/shop', { keypadId: keypadInput.value })
    }
  } else {
    if (keypadInput.value.length < 6) {
      keypadInput.value += key
    }
  }
}

const keys = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'back'],
]
</script>

<template>
  <KioskLayout>
    <Head :title="t('kiosk.title')" />

    <div class="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 class="mb-2 text-4xl font-bold text-white">{{ t('kiosk.heading') }}</h1>
      <p class="mb-8 text-lg text-gray-400">{{ t('kiosk.enter_number') }}</p>

      <!-- Display -->
      <div
        class="mb-8 flex h-20 w-80 items-center justify-center rounded-xl border-2 border-gray-600 bg-gray-800 text-5xl font-bold tracking-widest text-white"
      >
        {{ keypadInput || '—' }}
      </div>

      <!-- Keypad -->
      <div class="grid grid-cols-3 gap-3">
        <template v-for="row in keys" :key="row.join('')">
          <button
            v-for="key in row"
            :key="key"
            class="flex h-20 w-20 items-center justify-center rounded-xl text-2xl font-bold transition-all"
            :class="{
              'bg-gray-700 text-white hover:bg-gray-600': !['clear', 'back', 'enter'].includes(key),
              'bg-red-700 text-white hover:bg-red-600': key === 'clear',
              'bg-yellow-700 text-white hover:bg-yellow-600': key === 'back',
            }"
            @click="pressKey(key)"
          >
            <template v-if="key === 'clear'">C</template>
            <template v-else-if="key === 'back'">
              <i class="pi pi-arrow-left" />
            </template>
            <template v-else>{{ key }}</template>
          </button>
        </template>
      </div>

      <!-- Enter button -->
      <Button
        :label="t('common.continue')"
        icon="pi pi-arrow-right"
        size="large"
        class="mt-6 w-80"
        :disabled="!keypadInput"
        @click="pressKey('enter')"
      />
    </div>
  </KioskLayout>
</template>
