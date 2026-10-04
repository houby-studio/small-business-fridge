<script setup lang="ts">
import { computed } from 'vue'
import Select from 'primevue/select'
import InfoHint from '~/components/InfoHint.vue'
import { useI18n } from '~/composables/use_i18n'

export interface ProductGroupOption {
  id: number
  name: string
  categoryId: number
}

const props = defineProps<{
  groups: ProductGroupOption[]
  /** The product's category — its groups are offered first. */
  categoryId: number | null
  inputId: string
}>()

const model = defineModel<number | null>({ required: true })
const { t } = useI18n()

const options = computed(() => {
  const sameCategory = props.groups.filter((g) => g.categoryId === props.categoryId)
  const others = props.groups.filter((g) => g.categoryId !== props.categoryId)
  return [
    { label: t('shopping.group_none'), value: null },
    ...[...sameCategory, ...others].map((g) => ({ label: g.name, value: g.id })),
  ]
})
</script>

<template>
  <div>
    <label :for="inputId" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">
      {{ t('shopping.group_field_label') }}
      <InfoHint :text="t('shopping.group_field_hint')" test-id="product-group-hint" />
    </label>
    <Select
      v-model="model"
      :inputId="inputId"
      :options="options"
      optionLabel="label"
      optionValue="value"
      filter
      class="w-full"
      data-testid="product-group-select"
    />
  </div>
</template>
