<script setup lang="ts">
/**
 * Consent to share the product with Open Food Facts — the free database the barcode
 * lookup reads from. Shown only for a public EAN (in-store codes name nothing outside the
 * shop) and only when there is something left to send: name and EAN go once per
 * barcode, a new own photo can always follow. Unchecked by default.
 */
import { computed, watch } from 'vue'
import Checkbox from 'primevue/checkbox'
import { useI18n } from '~/composables/use_i18n'
import { isPublicGtin } from '~/composables/use_gtin'

const props = defineProps<{
  enabled: boolean
  barcode: string
  /** The picture is the supplier's own file, not a link or an Open Food Facts picture. */
  hasOwnPhoto: boolean
  /** Name and EAN were shared before (edit form). */
  alreadyShared?: boolean
}>()

const model = defineModel<boolean>({ required: true })

const { t } = useI18n()

const visible = computed(
  () => props.enabled && isPublicGtin(props.barcode) && (!props.alreadyShared || props.hasOwnPhoto)
)
const what = computed(() => {
  if (props.alreadyShared) return t('supplier.off_contribute_what_photo')
  return props.hasOwnPhoto
    ? t('supplier.off_contribute_what_all')
    : t('supplier.off_contribute_what_data')
})
// A consent given for a barcode that no longer qualifies must not travel with the form.
watch(visible, (shown) => {
  if (!shown) model.value = false
})
</script>

<template>
  <div
    v-if="visible"
    class="rounded-lg border border-gray-200 p-3 dark:border-zinc-700"
    data-testid="product-off-contribution"
  >
    <div class="flex items-start gap-2">
      <Checkbox v-model="model" inputId="product-off-contribute" :binary="true" class="mt-0.5" />
      <label for="product-off-contribute" class="text-sm text-gray-700 dark:text-zinc-300">
        {{ t('supplier.off_contribute_label') }}
      </label>
    </div>
    <p class="mt-1 ml-7 text-xs text-gray-500 dark:text-zinc-400">
      {{ what }}
      <template v-if="hasOwnPhoto">{{ t('supplier.off_contribute_license') }}</template>
      <template v-else-if="!alreadyShared">{{ t('supplier.off_contribute_no_photo') }}</template>
    </p>
  </div>
</template>
