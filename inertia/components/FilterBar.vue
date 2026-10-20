<script setup lang="ts">
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'

/**
 * Layout for a list's filters. There is no "Apply" button: every filter applies the moment
 * it changes (a Select on `@change`, a text field on Enter), the page decides how. "Clear"
 * only shows while some filter differs from its default (`active`).
 */
withDefaults(defineProps<{ active?: boolean }>(), { active: true })

const emit = defineEmits<{
  clear: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="mb-4 flex flex-wrap items-end gap-3" data-testid="filter-bar">
    <slot />
    <Button
      v-if="active"
      :label="t('common.filter_clear')"
      icon="pi pi-filter-slash"
      size="small"
      severity="secondary"
      text
      data-testid="filter-clear"
      @click="emit('clear')"
    />
  </div>
</template>
