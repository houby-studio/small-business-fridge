<script setup lang="ts">
import { ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Popover from 'primevue/popover'
import { useI18n } from '~/composables/use_i18n'

/**
 * An (i) button that reveals an explanation on click — the one place for text that would
 * otherwise sit under a heading. `popover` for a sentence or two, `dialog` for anything
 * longer or structured. Click, not hover, so it works on touch; `v-tooltip` is not used
 * because it crashes in this app.
 */
const props = withDefaults(
  defineProps<{
    text?: string
    title?: string
    mode?: 'popover' | 'dialog'
    label?: string
    testId?: string
  }>(),
  { mode: 'popover' }
)

const { t } = useI18n()
const popover = ref<InstanceType<typeof Popover> | null>(null)
const dialogVisible = ref(false)

function toggle(event: Event) {
  if (props.mode === 'dialog') {
    dialogVisible.value = true
    return
  }
  popover.value?.toggle(event)
}
</script>

<template>
  <span class="inline-flex align-middle">
    <Button
      icon="pi pi-info-circle"
      severity="secondary"
      text
      size="small"
      class="!h-6 !w-6 !p-0"
      :aria-label="label ?? t('common.more_info')"
      aria-haspopup="dialog"
      :data-testid="testId"
      @click="toggle"
    />
    <Popover v-if="mode === 'popover'" ref="popover">
      <div class="max-w-xs text-sm text-gray-700 dark:text-zinc-300">
        <slot>{{ text }}</slot>
      </div>
    </Popover>
    <Dialog
      v-else
      v-model:visible="dialogVisible"
      :header="title ?? t('common.more_info')"
      :style="{ width: '28rem', maxWidth: 'calc(100vw - 2rem)' }"
      modal
      :draggable="false"
    >
      <div class="text-sm whitespace-pre-line text-gray-700 dark:text-zinc-300">
        <slot>{{ text }}</slot>
      </div>
    </Dialog>
  </span>
</template>
