<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import FileUpload from 'primevue/fileupload'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

export interface ProductImageCapabilities {
  backgrounds: string[]
  openFoodFacts: boolean
}

interface Candidate {
  url: string
  thumbUrl: string
  source: string
}

type Source =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }
  | { kind: 'stored'; productId: number }

const props = defineProps<{
  capabilities: ProductImageCapabilities
  barcode: string
  chooseLabel: string
  /** Edit form: the product whose current image can be run through the pipeline. */
  storedImageProductId?: number | null
}>()

const emit = defineEmits<{
  /** The processed WebP ready to submit, or null while there is none. */
  (e: 'update:file', file: File | null): void
  /** Object URL of the processed image for the preview card. */
  (e: 'preview', url: string | null): void
  (e: 'busy', busy: boolean): void
  /** Product name Open Food Facts knows for the barcode. */
  (e: 'suggestName', name: string): void
}>()

const { t } = useI18n()

const source = ref<Source | null>(null)
const background = ref('auto')
const rotate = ref('auto')
const urlInput = ref('')
const processing = ref(false)
const error = ref('')
const resultInfo = ref<{ background: string; rotated: string; note: string } | null>(null)
const candidates = ref<Candidate[]>([])
const candidatesLoading = ref(false)
const candidatesSearched = ref(false)
const offName = ref<string | null>(null)

let previewUrl: string | null = null
let controller: AbortController | null = null

const backgroundOptions = computed(() =>
  props.capabilities.backgrounds.map((value) => ({
    value,
    label: t(`supplier.products_image_bg_${value}`),
  }))
)
const rotateOptions = computed(() =>
  ['auto', 'none', 'ccw', 'cw'].map((value) => ({
    value,
    label: t(`supplier.products_image_rotate_${value}`),
  }))
)
const barcodeSearchable = computed(() => /^\d{8,14}$/.test(props.barcode.trim()))
const urlValid = computed(() => /^https?:\/\/\S+$/i.test(urlInput.value.trim()))
const resultSummary = computed(() => {
  if (!resultInfo.value) return ''
  const parts = [
    resultInfo.value.note === 'already_transparent'
      ? t('supplier.products_image_result_already_transparent')
      : t(`supplier.products_image_result_bg_${resultInfo.value.background}`),
  ]
  if (resultInfo.value.rotated !== 'none') parts.push(t('supplier.products_image_result_rotated'))
  return parts.join(' · ')
})

function xsrfToken() {
  return decodeURIComponent(document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? '')
}

function setPreview(url: string | null) {
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = url
  emit('preview', url)
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string
    errors?: { message: string }[]
  } | null
  return body?.errors?.[0]?.message ?? body?.message ?? t('supplier.products_image_failed')
}

async function processImage() {
  if (!source.value) return
  controller?.abort()
  const current = new AbortController()
  controller = current

  const body = new FormData()
  if (source.value.kind === 'file') body.append('image', source.value.file)
  else if (source.value.kind === 'url') body.append('url', source.value.url)
  else body.append('productId', String(source.value.productId))
  body.append('background', background.value)
  body.append('rotate', rotate.value)

  processing.value = true
  error.value = ''
  emit('busy', true)
  emit('update:file', null)
  try {
    const response = await fetch('/supplier/products/image/process', {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-XSRF-TOKEN': xsrfToken() },
      signal: current.signal,
    })
    if (!response.ok) {
      error.value = await errorMessage(response)
      resultInfo.value = null
      setPreview(null)
      return
    }
    const blob = await response.blob()
    const file = new File([blob], 'product.webp', { type: 'image/webp' })
    resultInfo.value = {
      background: response.headers.get('X-Image-Background') ?? 'none',
      rotated: response.headers.get('X-Image-Rotated') ?? 'none',
      note: response.headers.get('X-Image-Note') ?? 'none',
    }
    setPreview(URL.createObjectURL(file))
    emit('update:file', file)
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    error.value = t('supplier.products_image_failed')
  } finally {
    if (controller === current) {
      processing.value = false
      emit('busy', false)
    }
  }
}

function useFile(file: File | null | undefined) {
  if (!file) return
  source.value = { kind: 'file', file }
  processImage()
}

function useUrl(url: string) {
  source.value = { kind: 'url', url }
  processImage()
}

function useStoredImage() {
  if (!props.storedImageProductId) return
  source.value = { kind: 'stored', productId: props.storedImageProductId }
  processImage()
}

function onSelect(event: { files: File[] }) {
  useFile(event.files[0])
}

function loadUrl() {
  if (urlValid.value) useUrl(urlInput.value.trim())
}

async function searchCandidates() {
  if (!barcodeSearchable.value) return
  candidatesLoading.value = true
  try {
    const response = await fetch(
      `/supplier/products/image/candidates?barcode=${encodeURIComponent(props.barcode.trim())}`,
      { headers: { Accept: 'application/json' }, credentials: 'same-origin' }
    )
    const body = response.ok
      ? ((await response.json()) as { productName: string | null; candidates: Candidate[] })
      : { productName: null, candidates: [] }
    candidates.value = body.candidates
    offName.value = body.productName
  } finally {
    candidatesLoading.value = false
    candidatesSearched.value = true
  }
}

/** Ctrl+V anywhere on the page: an image from the clipboard, or a copied image link. */
function onPaste(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  const typingElsewhere =
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
    target.id !== 'product-image-url'
  const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
  if (file) {
    event.preventDefault()
    useFile(file)
    return
  }
  if (typingElsewhere) return
  const text = event.clipboardData?.getData('text')?.trim() ?? ''
  if (/^https?:\/\/\S+$/i.test(text)) {
    event.preventDefault()
    urlInput.value = text
    useUrl(text)
  }
}

watch([background, rotate], () => processImage())

onMounted(() => window.addEventListener('paste', onPaste))
onUnmounted(() => {
  window.removeEventListener('paste', onPaste)
  controller?.abort()
  setPreview(null)
})
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="product-image-picker">
    <div class="flex flex-wrap items-center gap-2">
      <FileUpload
        mode="basic"
        accept=".jpg,.jpeg,.png,.webp,.gif,.avif"
        :maxFileSize="15 * 1024 * 1024"
        :chooseLabel="chooseLabel"
        :auto="false"
        @select="onSelect"
      />
      <Button
        v-if="storedImageProductId"
        :label="t('supplier.products_image_reprocess')"
        icon="pi pi-refresh"
        severity="secondary"
        :disabled="processing"
        @click="useStoredImage"
      />
      <Button
        v-if="capabilities.openFoodFacts"
        :label="t('supplier.products_image_search_barcode')"
        icon="pi pi-search"
        severity="secondary"
        :disabled="!barcodeSearchable || candidatesLoading"
        :loading="candidatesLoading"
        @click="searchCandidates"
      />
    </div>
    <small class="text-gray-500 dark:text-zinc-400">{{
      t('supplier.products_image_paste_hint')
    }}</small>

    <div class="flex gap-2">
      <InputText
        id="product-image-url"
        v-model="urlInput"
        class="w-full"
        :placeholder="t('supplier.products_image_url_placeholder')"
        @keydown.enter.prevent="loadUrl"
      />
      <Button
        :label="t('supplier.products_image_url_load')"
        severity="secondary"
        :disabled="!urlValid || processing"
        @click="loadUrl"
      />
    </div>

    <div v-if="candidatesSearched" data-testid="product-image-candidates">
      <div
        v-if="offName"
        class="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-zinc-400"
      >
        <span>{{ t('supplier.products_image_off_name') }}: {{ offName }}</span>
        <Button
          :label="t('supplier.products_image_off_use_name')"
          severity="secondary"
          text
          size="small"
          @click="emit('suggestName', offName!)"
        />
      </div>
      <div v-if="candidates.length" class="grid grid-cols-4 gap-2 sm:grid-cols-6">
        <Button
          v-for="candidate in candidates"
          :key="candidate.url"
          severity="secondary"
          outlined
          class="h-20 overflow-hidden !bg-white !p-1"
          :aria-label="t('supplier.products_image_use_candidate')"
          @click="useUrl(candidate.url)"
        >
          <img
            :src="candidate.thumbUrl"
            alt=""
            class="h-full w-full object-contain"
            loading="lazy"
          />
        </Button>
      </div>
      <small v-else class="text-gray-500 dark:text-zinc-400">{{
        t('supplier.products_image_no_candidates')
      }}</small>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.products_image_bg_label')
        }}</label>
        <Select
          v-model="background"
          inputId="product-image-background"
          :options="backgroundOptions"
          optionLabel="label"
          optionValue="value"
          class="w-full"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.products_image_rotate_label')
        }}</label>
        <Select
          v-model="rotate"
          inputId="product-image-rotate"
          :options="rotateOptions"
          optionLabel="label"
          optionValue="value"
          class="w-full"
        />
      </div>
    </div>

    <small
      v-if="processing"
      class="text-gray-500 dark:text-zinc-400"
      data-testid="product-image-status"
    >
      <span class="pi pi-spin pi-spinner mr-1" />{{ t('supplier.products_image_processing') }}
    </small>
    <small
      v-else-if="resultSummary"
      class="text-gray-500 dark:text-zinc-400"
      data-testid="product-image-status"
      >{{ resultSummary }}</small
    >
    <Message v-if="error" severity="error" size="small" data-testid="product-image-error">{{
      error
    }}</Message>
  </div>
</template>
