<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  loading: boolean
}>()

const emit = defineEmits<{
  submit: [keypadId: string]
}>()

const { t } = useI18n()
const keypadInput = ref('')
const tonePlayers = new Map<string, HTMLAudioElement>()

function resolveToneFile(key: string): string | null {
  if (key >= '0' && key <= '9') return `${key}.wav`
  if (key === 'clear') return 'star.wav'
  if (key === 'back') return 'hash.wav'
  if (key === 'enter') return '0.wav'
  return null
}

function playTone(key: string) {
  const toneFile = resolveToneFile(key)
  if (!toneFile) return

  let player = tonePlayers.get(toneFile)
  if (!player) {
    player = new Audio(`/keypad/${toneFile}`)
    player.preload = 'auto'
    tonePlayers.set(toneFile, player)
  }

  player.currentTime = 0
  void player.play().catch(() => {
    // Ignore playback failures due to browser autoplay restrictions.
  })
}

function pressKey(key: string) {
  playTone(key)

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
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return
  }

  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault()
    pressKey(e.key)
  } else if (e.key === 'Backspace') {
    e.preventDefault()
    pressKey('back')
  } else if (e.key === 'Delete' || e.key === 'Escape') {
    e.preventDefault()
    pressKey('clear')
  } else if (e.key === 'Enter') {
    e.preventDefault()
    pressKey('enter')
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  // Pre-load all tone files so the first keypress plays without a network delay.
  for (const file of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'star', 'hash']) {
    const toneFile = `${file}.wav`
    const player = new Audio(`/keypad/${toneFile}`)
    player.preload = 'auto'
    tonePlayers.set(toneFile, player)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  for (const player of tonePlayers.values()) {
    player.pause()
  }
  tonePlayers.clear()
})

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
      <h1 class="text-3xl font-bold text-white">{{ t('common.app_name') }}</h1>
      <p class="mt-1 text-base text-gray-400">{{ t('kiosk.enter_number') }}</p>
    </div>

    <!-- Display field -->
    <div class="relative mb-6 w-full max-w-xs">
      <div
        class="flex h-20 w-full items-center justify-center rounded-2xl border-2 border-gray-600 bg-gray-900 text-5xl font-bold tracking-widest"
      >
        {{ keypadInput || '—' }}
      </div>
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
