<script setup lang="ts">
/**
 * Barcode input with an Open Food Facts lookup right next to it: the supplier usually has
 * the product in hand, so the barcode is where a new product starts. Found pictures go to
 * the image tile, a found name can be taken over — nothing is applied without a click.
 */
import { computed, ref } from 'vue'
import InputText from 'primevue/inputtext'
import InputGroup from 'primevue/inputgroup'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useI18n } from '~/composables/use_i18n'

interface Candidate {
  url: string
  thumbUrl: string
}

const props = defineProps<{
  inputId: string
  lookupEnabled: boolean
  invalid?: boolean
  placeholder?: string
}>()

const model = defineModel<string>({ required: true })

const emit = defineEmits<{
  (e: 'pickImage', url: string): void
  (e: 'useName', name: string): void
  /** Enter in the field — the page moves focus on. */
  (e: 'enter'): void
}>()

const { t } = useI18n()

const loading = ref(false)
const searched = ref(false)
const hint = ref('')
const candidates = ref<Candidate[]>([])
const foundName = ref<string | null>(null)
const picked = ref<string | null>(null)

const searchable = computed(() => /^\d{8,14}$/.test(model.value.trim()))

async function search() {
  hint.value = ''
  if (!searchable.value) {
    hint.value = t('supplier.barcode_lookup_needs_code')
    return
  }
  loading.value = true
  try {
    const response = await fetch(
      `/supplier/products/image/candidates?barcode=${encodeURIComponent(model.value.trim())}`,
      { headers: { Accept: 'application/json' }, credentials: 'same-origin' }
    )
    const body = response.ok
      ? ((await response.json()) as { productName: string | null; candidates: Candidate[] })
      : { productName: null, candidates: [] }
    candidates.value = body.candidates
    foundName.value = body.productName
    picked.value = null
    searched.value = true
  } finally {
    loading.value = false
  }
}

function pick(candidate: Candidate) {
  picked.value = candidate.url
  emit('pickImage', candidate.url)
}

function close() {
  searched.value = false
  candidates.value = []
  foundName.value = null
}

function onEnter() {
  if (props.lookupEnabled && searchable.value) search()
  emit('enter')
}
</script>

<template>
  <div>
    <InputGroup v-if="lookupEnabled">
      <InputText
        :id="inputId"
        v-model="model"
        inputmode="numeric"
        :placeholder="placeholder"
        :invalid="invalid"
        @keydown.enter.prevent="onEnter"
      />
      <Button
        :label="t('supplier.barcode_lookup')"
        icon="pi pi-search"
        severity="secondary"
        :loading="loading"
        :disabled="loading"
        @click="search"
      />
    </InputGroup>
    <InputText
      v-else
      :id="inputId"
      v-model="model"
      inputmode="numeric"
      class="w-full"
      :placeholder="placeholder"
      :invalid="invalid"
      @keydown.enter.prevent="emit('enter')"
    />
    <small v-if="hint" class="text-gray-500 dark:text-zinc-400">{{ hint }}</small>

    <div
      v-if="searched"
      class="mt-2 rounded-lg border border-gray-200 p-3 dark:border-zinc-700"
      data-testid="barcode-lookup-results"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="text-sm text-gray-700 dark:text-zinc-300">
          {{
            foundName
              ? t('supplier.barcode_lookup_found', { name: foundName })
              : t('supplier.barcode_lookup_pictures')
          }}
        </span>
        <Button
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          :aria-label="t('common.close')"
          @click="close"
        />
      </div>
      <Button
        v-if="foundName"
        :label="t('supplier.barcode_lookup_use_name')"
        severity="secondary"
        text
        size="small"
        class="mb-2"
        @click="emit('useName', foundName!)"
      />
      <div v-if="candidates.length" class="grid grid-cols-4 gap-2 sm:grid-cols-6">
        <Button
          v-for="candidate in candidates"
          :key="candidate.url"
          severity="secondary"
          :outlined="picked !== candidate.url"
          class="h-20 w-full overflow-hidden !p-1"
          :aria-label="t('supplier.barcode_lookup_use_picture')"
          :aria-pressed="picked === candidate.url"
          @click="pick(candidate)"
        >
          <img :src="candidate.thumbUrl" alt="" class="h-full w-full rounded object-contain" />
        </Button>
      </div>
      <Message v-else severity="secondary" size="small">{{
        t('supplier.barcode_lookup_none')
      }}</Message>
    </div>
  </div>
</template>
