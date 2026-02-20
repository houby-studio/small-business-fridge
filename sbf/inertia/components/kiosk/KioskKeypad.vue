<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'

interface CustomerInfo {
  id: number
  displayName: string
  keypadId: number
}

const props = defineProps<{
  customer: CustomerInfo | null
  error: string | null
}>()

const emit = defineEmits<{
  submit: [keypadId: string]
}>()

const { t } = useI18n()
const keypadInput = ref('')
const displayRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  displayRef.value?.focus()
})

function pressKey(key: string) {
  if (key === 'clear') {
    keypadInput.value = ''
  } else if (key === 'back') {
    keypadInput.value = keypadInput.value.slice(0, -1)
  } else if (key === 'enter') {
    if (keypadInput.value) {
      emit('submit', keypadInput.value)
    }
  } else {
    if (keypadInput.value.length < 6) {
      keypadInput.value += key
    }
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key >= '0' && e.key <= '9') {
    pressKey(e.key)
  } else if (e.key === 'Backspace') {
    pressKey('back')
  } else if (e.key === 'Delete' || e.key === 'Escape') {
    pressKey('clear')
  } else if (e.key === 'Enter') {
    pressKey('enter')
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
  <div class="flex flex-col items-center justify-center p-8">
    <!-- Greeting when customer identified -->
    <div v-if="customer" class="mb-4 text-center">
      <p class="text-xl font-semibold text-green-400">
        {{ t('kiosk.greeting', { name: customer.displayName }) }}
      </p>
    </div>
    <div v-else class="mb-4 text-center">
      <h1 class="mb-1 text-3xl font-bold text-white">{{ t('kiosk.heading') }}</h1>
      <p class="text-base text-gray-400">{{ t('kiosk.enter_number') }}</p>
    </div>

    <!-- Display field (also captures keyboard/scanner input) -->
    <div class="relative mb-6 w-full max-w-xs">
      <div
        class="flex h-20 w-full items-center justify-center rounded-2xl border-2 border-gray-600 bg-gray-900 text-5xl font-bold tracking-widest text-white"
      >
        {{ keypadInput || '—' }}
      </div>
      <!-- Hidden input for scanner/keyboard focus -->
      <input
        ref="displayRef"
        class="absolute inset-0 opacity-0"
        aria-label="keypad input"
        @keydown="onKeydown"
      />
    </div>

    <!-- Error -->
    <div v-if="error" class="mb-4 w-full max-w-xs rounded-xl bg-red-900/50 px-4 py-2 text-center">
      <p class="text-sm text-red-300">{{ error }}</p>
    </div>

    <!-- Keypad grid -->
    <div class="grid grid-cols-3 gap-3">
      <template v-for="row in keys" :key="row.join('')">
        <button
          v-for="key in row"
          :key="key"
          class="flex h-24 w-24 items-center justify-center rounded-xl text-2xl font-bold transition-all"
          :class="{
            'bg-gray-700 text-white hover:bg-gray-600 active:bg-gray-500': ![
              'clear',
              'back',
              'enter',
            ].includes(key),
            'bg-red-700 text-white hover:bg-red-600 active:bg-red-500': key === 'clear',
            'bg-yellow-700 text-white hover:bg-yellow-600 active:bg-yellow-500': key === 'back',
          }"
          :aria-label="
            key === 'clear' ? t('kiosk.clear') : key === 'back' ? t('kiosk.backspace') : key
          "
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

    <!-- Continue button -->
    <Button
      :label="t('common.continue')"
      icon="pi pi-arrow-right"
      size="large"
      class="mt-6 w-full max-w-xs"
      :disabled="!keypadInput"
      @click="pressKey('enter')"
    />
  </div>
</template>
