<script setup lang="ts">
/**
 * The product image as one tile: the preview is also where a picture is dropped, pasted
 * or chosen, and the few adjustments live right under it. What the tile shows is what
 * gets saved. The server picks the background-removal method (see docs/product-images.md)
 * — the supplier only says *what* they want, never *how*.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import FileUpload from 'primevue/fileupload'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

export interface ProductImageCapabilities {
  backgrounds: string[]
  openFoodFacts: boolean
  openFoodFactsContribute: boolean
}

type Source =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }
  | { kind: 'stored'; productId: number }

type BackgroundMethod = 'auto' | 'none' | 'flood'

interface Result {
  url: string
  file: File
  background: string
  rotated: boolean
  note: string
}

const props = defineProps<{
  capabilities: ProductImageCapabilities
  /** Edit form: the image the product has now, and its id to process it from storage. */
  storedImageUrl?: string | null
  storedImageProductId?: number | null
  alt: string
}>()

const emit = defineEmits<{
  /** The processed WebP to submit; null = nothing new (the edit form keeps the old one). */
  (e: 'update:file', file: File | null): void
  (e: 'busy', busy: boolean): void
  /**
   * The supplier's own photo as picked, with the background choice behind the preview —
   * what may go to Open Food Facts. `null` for a link, an Open Food Facts picture or the
   * stored image: those are not the supplier's to license.
   */
  (e: 'update:original', original: { file: File; background: BackgroundMethod } | null): void
}>()

const { t } = useI18n()

/** PrimeVue's typings omit the instance methods it has at runtime; type what we call. */
const fileUpload = ref<{ choose: () => void; clear: () => void } | null>(null)
const source = ref<Source | null>(null)
// Rotating a stored image must not touch its background unless asked to.
const method = ref<BackgroundMethod>(props.storedImageUrl ? 'none' : 'auto')
const keepOrientation = ref(false)
const turn = ref(0)
const processing = ref(false)
const error = ref('')
const result = ref<Result | null>(null)
const linkOpen = ref(false)
const urlInput = ref('')
const moreOpen = ref(false)
const dragging = ref(false)

let controller: AbortController | null = null

const isEdit = computed(() => !!props.storedImageUrl)
const displayUrl = computed(() => result.value?.url ?? props.storedImageUrl ?? null)
const changed = computed(() => !!result.value)
const canAdjust = computed(
  () => !!result.value || (!!props.storedImageProductId && !!props.storedImageUrl)
)
const backgroundChoice = computed({
  get: () => {
    if (!changed.value) return null
    return method.value === 'none' ? 'keep' : 'remove'
  },
  set: (value: string | null) => {
    if (!value) return
    method.value = value === 'keep' ? 'none' : 'auto'
    run()
  },
})
const backgroundOptions = computed(() => [
  { value: 'remove', label: t('supplier.image_bg_remove') },
  { value: 'keep', label: t('supplier.image_bg_keep') },
])
const urlValid = computed(() => /^https?:\/\/\S+$/i.test(urlInput.value.trim()))
const floodAvailable = computed(() => props.capabilities.backgrounds.includes('flood'))

const statusText = computed(() => {
  if (!result.value) return ''
  const parts: string[] = []
  if (result.value.note === 'already_transparent') parts.push(t('supplier.image_status_was_clear'))
  else if (result.value.background === 'none') parts.push(t('supplier.image_status_bg_kept'))
  else parts.push(t('supplier.image_status_bg_removed'))
  if (result.value.rotated) parts.push(t('supplier.image_status_rotated'))
  return t('supplier.image_status_done', { what: parts.join(', ') })
})

function xsrfToken() {
  return decodeURIComponent(document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? '')
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string
    errors?: { message: string }[]
  } | null
  return body?.errors?.[0]?.message ?? body?.message ?? t('supplier.image_failed')
}

function replaceResult(next: Result | null) {
  if (result.value && result.value.url !== next?.url) URL.revokeObjectURL(result.value.url)
  result.value = next
}

async function run() {
  if (!source.value) {
    if (!props.storedImageProductId) return
    source.value = { kind: 'stored', productId: props.storedImageProductId }
  }
  controller?.abort()
  const current = new AbortController()
  controller = current

  const body = new FormData()
  if (source.value.kind === 'file') body.append('image', source.value.file)
  else if (source.value.kind === 'url') body.append('url', source.value.url)
  else body.append('productId', String(source.value.productId))
  body.append('background', method.value)
  body.append('rotate', keepOrientation.value ? 'none' : 'auto')
  body.append('turn', String(turn.value))

  processing.value = true
  error.value = ''
  emit('busy', true)
  try {
    const response = await fetch('/supplier/products/image/process', {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-XSRF-TOKEN': xsrfToken() },
      signal: current.signal,
    })
    if (!response.ok) {
      // Keep the last good picture: a failed retry must not cost the supplier their image.
      error.value = await errorMessage(response)
      return
    }
    const blob = await response.blob()
    const file = new File([blob], 'product.webp', { type: 'image/webp' })
    replaceResult({
      url: URL.createObjectURL(file),
      file,
      background: response.headers.get('X-Image-Background') ?? 'none',
      rotated:
        (response.headers.get('X-Image-Rotated') ?? 'none') !== 'none' || turn.value % 4 !== 0,
      note: response.headers.get('X-Image-Note') ?? 'none',
    })
    emit('update:file', file)
    emit(
      'update:original',
      source.value?.kind === 'file' ? { file: source.value.file, background: method.value } : null
    )
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    error.value = t('supplier.image_failed')
  } finally {
    if (controller === current) {
      processing.value = false
      emit('busy', false)
    }
  }
}

/** A new picture starts from the defaults again. */
function start(next: Source) {
  source.value = next
  method.value = 'auto'
  keepOrientation.value = false
  turn.value = 0
  moreOpen.value = false
  run()
}

function useFile(file: File | null | undefined) {
  if (file) start({ kind: 'file', file })
}

function useUrl(url: string) {
  linkOpen.value = false
  urlInput.value = ''
  start({ kind: 'url', url })
}

function onSelect(event: { files: File[] }) {
  useFile(event.files[0])
  // Let the same file be picked again after "Vrátit původní".
  fileUpload.value?.clear()
}

function choose() {
  fileUpload.value?.choose()
}

function loadLink() {
  if (urlValid.value) useUrl(urlInput.value.trim())
}

function rotateBy(delta: number) {
  turn.value += delta
  run()
}

function removeWhiteOnly() {
  method.value = 'flood'
  run()
}

function keepAsIs() {
  keepOrientation.value = true
  turn.value = 0
  run()
}

function revert() {
  controller?.abort()
  source.value = null
  method.value = 'none'
  keepOrientation.value = false
  turn.value = 0
  error.value = ''
  moreOpen.value = false
  replaceResult(null)
  emit('update:file', null)
  emit('update:original', null)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  useFile([...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/')))
}

/** Ctrl+V anywhere: a copied picture, or a copied link to one. */
function onPaste(event: ClipboardEvent) {
  const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
  if (file) {
    event.preventDefault()
    useFile(file)
    return
  }
  const target = event.target as HTMLElement | null
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  if (typing && target.id !== 'product-image-url') return
  const text = event.clipboardData?.getData('text')?.trim() ?? ''
  if (/^https?:\/\/\S+$/i.test(text)) {
    event.preventDefault()
    useUrl(text)
  }
}

defineExpose({ useUrl })

onMounted(() => window.addEventListener('paste', onPaste))
onUnmounted(() => {
  window.removeEventListener('paste', onPaste)
  controller?.abort()
  replaceResult(null)
})
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="product-image-picker">
    <!-- The tile: preview, drop zone and click target in one. 9:16 like the stored image. -->
    <div
      class="sbf-transparency-grid relative mx-auto aspect-[9/16] w-full max-w-[9rem] sm:max-w-[12rem] lg:max-w-[15rem] overflow-hidden rounded-lg border border-dashed transition-colors"
      :class="[
        dragging ? 'border-primary' : 'border-gray-300 dark:border-zinc-700',
        displayUrl ? '' : 'cursor-pointer hover:border-primary',
      ]"
      data-testid="product-image-tile"
      @click="!displayUrl && choose()"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <img
        v-if="displayUrl"
        :src="displayUrl"
        :alt="alt"
        class="h-full w-full object-contain"
        data-testid="product-image-preview"
      />
      <div
        v-else
        class="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-gray-500 dark:text-zinc-400"
      >
        <span class="pi pi-image !text-4xl text-gray-300 dark:text-zinc-600" />
        <!-- Drag & drop and Ctrl+V only mean something with a mouse and a keyboard -->
        <span class="hidden pointer-fine:inline">{{ t('supplier.image_drop_hint') }}</span>
        <span class="pointer-fine:hidden">{{ t('supplier.image_tap_hint') }}</span>
      </div>

      <span
        v-if="isEdit && !changed && !processing"
        class="absolute top-2 left-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-zinc-700 dark:text-zinc-200"
        >{{ t('supplier.image_saved_badge') }}</span
      >

      <div
        v-if="processing"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/70 text-sm text-gray-700 dark:bg-zinc-900/70 dark:text-zinc-200"
        data-testid="product-image-processing"
      >
        <span class="pi pi-spin pi-spinner text-2xl" />
        <span>{{ t('supplier.image_processing') }}</span>
      </div>
    </div>

    <!-- What happened, in plain words -->
    <small
      v-if="statusText && !processing"
      class="text-center text-gray-600 dark:text-zinc-400"
      data-testid="product-image-status"
      ><span class="pi pi-check mr-1 text-green-600 dark:text-green-400" />{{ statusText }}</small
    >
    <Message v-if="error" severity="error" size="small" data-testid="product-image-error">
      {{ error }}
    </Message>

    <!-- Adjustments: only once there is a picture to adjust -->
    <div v-if="canAdjust" class="flex flex-wrap items-center justify-center gap-2">
      <Button
        icon="pi pi-replay"
        severity="secondary"
        text
        size="small"
        :aria-label="t('supplier.image_rotate_left')"
        :disabled="processing"
        @click="rotateBy(-1)"
      />
      <Button
        icon="pi pi-refresh"
        severity="secondary"
        text
        size="small"
        :aria-label="t('supplier.image_rotate_right')"
        :disabled="processing"
        @click="rotateBy(1)"
      />
      <SelectButton
        v-model="backgroundChoice"
        :options="backgroundOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        :disabled="processing"
        size="small"
        :aria-label="t('supplier.image_bg_label')"
        data-testid="product-image-background"
      />
    </div>

    <div v-if="changed" class="flex flex-col items-center gap-1">
      <Button
        :label="t('supplier.image_not_right')"
        :icon="moreOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
        iconPos="right"
        severity="secondary"
        text
        size="small"
        @click="moreOpen = !moreOpen"
      />
      <div v-if="moreOpen" class="flex flex-col items-center gap-1">
        <Button
          v-if="floodAvailable"
          :label="t('supplier.image_white_only')"
          severity="secondary"
          text
          size="small"
          :disabled="processing"
          @click="removeWhiteOnly"
        />
        <Button
          :label="t('supplier.image_keep_orientation')"
          severity="secondary"
          text
          size="small"
          :disabled="processing"
          @click="keepAsIs"
        />
        <Button
          :label="t('supplier.image_retry')"
          severity="secondary"
          text
          size="small"
          :disabled="processing"
          @click="run"
        />
      </div>
    </div>

    <!-- Sources: one button, one link; Ctrl+V and drag & drop work without either -->
    <div
      class="flex flex-wrap items-center justify-center gap-2 border-t border-gray-200 pt-3 dark:border-zinc-700"
    >
      <FileUpload
        ref="fileUpload"
        mode="basic"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        :maxFileSize="15 * 1024 * 1024"
        :chooseLabel="displayUrl ? t('supplier.image_choose_other') : t('supplier.image_choose')"
        chooseIcon="pi pi-camera"
        :chooseButtonProps="{ severity: 'secondary', outlined: true, size: 'small' }"
        :auto="false"
        @select="onSelect"
      >
        <template #filelabel><span class="hidden" /></template>
      </FileUpload>
      <Button
        :label="t('supplier.image_link')"
        icon="pi pi-link"
        severity="secondary"
        text
        size="small"
        @click="linkOpen = !linkOpen"
      />
      <Button
        v-if="isEdit && changed"
        :label="t('supplier.image_revert')"
        icon="pi pi-undo"
        severity="secondary"
        text
        size="small"
        @click="revert"
      />
    </div>
    <InputText
      v-if="linkOpen"
      id="product-image-url"
      v-model="urlInput"
      class="w-full"
      autofocus
      :placeholder="t('supplier.image_link_placeholder')"
      @keydown.enter.prevent="loadLink"
      @keydown.esc.prevent="linkOpen = false"
    />
  </div>
</template>
