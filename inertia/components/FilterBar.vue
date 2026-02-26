<script setup lang="ts">
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'

const emit = defineEmits<{
  apply: []
  clear: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="mb-4 flex flex-wrap items-end gap-3">
    <slot />
    <Button
      :label="t('common.filter_apply')"
      icon="pi pi-filter"
      size="small"
      @click="emit('apply')"
    />
    <Button
      :label="t('common.filter_clear')"
      size="small"
      severity="secondary"
      text
      @click="emit('clear')"
    />
  </div>
</template>
