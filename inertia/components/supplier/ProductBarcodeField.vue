<script setup lang="ts">
/**
 * Barcode input with an Open Food Facts lookup right next to it: the supplier usually has
 * the product in hand, so the barcode is where a new product starts. The page fills the
 * name from what is found (`found`); the found name stays here as a chip that puts it back
 * into the name field with one click. Pictures go to the image tile only on a click.
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
  /** The name field's current value — the chip shows whether the found name is in it. */
  currentName: string
}>()

const model = defineModel<string>({ required: true })

const emit = defineEmits<{
  (e: 'pickImage', url: string): void
  /** OFF knows the product. */
  (e: 'found', product: { name: string | null }): void
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
const known = ref(false)
const nameApplied = computed(
  () => !!foundName.value && props.currentName.trim() === foundName.value
)

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
      ? ((await response.json()) as {
          productName: string | null
          candidates: Candidate[]
          facts: unknown
        })
      : { productName: null, candidates: [], facts: null }
    candidates.value = body.candidates
    foundName.value = body.productName
    known.value = body.facts !== null
    picked.value = null
    searched.value = true
    if (known.value) emit('found', { name: body.productName })
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
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="text-sm text-gray-500 dark:text-zinc-400">{{
            known ? t('supplier.barcode_lookup_source') : t('supplier.barcode_lookup_unknown')
          }}</span>
          <!-- The found name as a chip: one click puts it (back) into the name field -->
          <Button
            v-if="foundName"
            :label="foundName"
            :icon="nameApplied ? 'pi pi-check' : 'pi pi-arrow-down-left'"
            :severity="nameApplied ? 'secondary' : 'info'"
            outlined
            size="small"
            class="max-w-full"
            :aria-label="
              nameApplied
                ? t('supplier.barcode_lookup_name_applied')
                : t('supplier.barcode_lookup_apply_name', { name: foundName })
            "
            data-testid="barcode-lookup-name"
            @click="emit('useName', foundName!)"
          />
        </div>
        <Button
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          :aria-label="t('common.close')"
          @click="close"
        />
      </div>
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
      <Message v-else-if="known" severity="secondary" size="small">{{
        t('supplier.barcode_lookup_none')
      }}</Message>
    </div>
  </div>
</template>
