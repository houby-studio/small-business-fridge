<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  loading: boolean
}>()

const emit = defineEmits<{
  submit: [keypadId: string]
}>()

const { t } = useI18n()
const keypadInput = ref('')
const hiddenRef = ref<HTMLInputElement | null>(null)

onMounted(() => {
  hiddenRef.value?.focus()
})

function pressKey(key: string) {
  if (key === 'clear') {
    keypadInput.value = ''
  } else if (key === 'back') {
    keypadInput.value = keypadInput.value.slice(0, -1)
  } else if (key === 'enter') {
    if (keypadInput.value) {
      emit('submit', keypadInput.value)
      keypadInput.value = ''
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
  <div class="flex h-full flex-col items-center justify-center p-8">
    <!-- Heading -->
    <div class="mb-6 text-center">
      <h1 class="text-3xl font-bold text-white">{{ t('kiosk.heading') }}</h1>
      <p class="mt-1 text-base text-gray-400">{{ t('kiosk.enter_number') }}</p>
    </div>

    <!-- Display field -->
    <div class="relative mb-6 w-full max-w-xs">
      <div
        class="flex h-20 w-full items-center justify-center rounded-2xl border-2 border-gray-600 bg-gray-900 text-5xl font-bold tracking-widest"
      >
        {{ keypadInput || '—' }}
      </div>
      <!-- Hidden input captures keyboard/scanner input -->
      <input
        ref="hiddenRef"
        class="absolute inset-0 opacity-0"
        aria-label="keypad input"
        @keydown="onKeydown"
      />
    </div>

    <!-- Keypad grid -->
    <div class="grid grid-cols-3 gap-3">
      <template v-for="row in keys" :key="row.join('')">
        <button
          v-for="key in row"
          :key="key"
          class="flex h-24 w-24 items-center justify-center rounded-xl text-2xl font-bold transition-all active:scale-95"
          :class="{
            'bg-gray-700 text-white hover:bg-gray-600': !['clear', 'back'].includes(key),
            'bg-red-700 text-white hover:bg-red-600': key === 'clear',
            'bg-yellow-700 text-white hover:bg-yellow-600': key === 'back',
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

    <!-- Continue button — same height as digit buttons -->
    <button
      class="mt-6 flex h-24 w-full max-w-xs items-center justify-center gap-3 rounded-2xl text-2xl font-bold transition-all active:scale-95"
      :class="
        !keypadInput || loading
          ? 'cursor-not-allowed bg-gray-700 text-gray-500'
          : 'bg-green-600 text-white hover:bg-green-500'
      "
      :disabled="!keypadInput || loading"
      @click="pressKey('enter')"
    >
      <i v-if="loading" class="pi pi-spin pi-spinner" />
      <i v-else class="pi pi-arrow-right" />
      {{ t('common.continue') }}
    </button>
  </div>
</template>
