<script setup lang="ts">
import InputNumber from 'primevue/inputnumber'

/**
 * PrimeVue's InputNumber with two behaviours the app relies on (CLAUDE.md › UI Component
 * Standards › Number fields):
 *
 * - The model follows every keystroke, not only blur. Plain InputNumber updates `v-model`
 *   when the field is left, so an error message and a disabled Save stay on screen after
 *   the number has been corrected, and Enter right after typing submits the old value.
 * - No `max`. InputNumber refuses a keystroke that would pass `max` and then moves the focus
 *   away (in a dialog onto its close button, so the next Enter closes it unsaved), or snaps
 *   the value to `max` silently. The upper bound belongs in the page's computed error and
 *   the server validator; a `max` passed here is deliberately swallowed.
 *
 * Everything else (inputId, min, fraction digits, mode, events, classes) goes straight
 * through to InputNumber. Use it everywhere instead of importing InputNumber directly.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue?: number | null
    /**
     * false = update on blur/Enter only, like plain InputNumber. For inline grids whose every
     * change is autosaved (the stocking draft), where per-keystroke updates would save and
     * re-render mid-typing.
     */
    live?: boolean
    /** Swallowed on purpose — see above. Validate the upper bound in the page instead. */
    max?: number
  }>(),
  // An absent Boolean prop would otherwise be cast to false.
  { live: true }
)

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

function onInput(event: { value: unknown }) {
  if (props.live === false) return
  const value = event.value
  if (value === null || value === undefined || value === '' || value === '-') {
    emit('update:modelValue', null)
    return
  }
  const number = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(number)) emit('update:modelValue', number)
}
</script>

<template>
  <InputNumber
    v-bind="$attrs"
    :modelValue="modelValue"
    @update:modelValue="(value: number | null) => emit('update:modelValue', value)"
    @input="onInput"
  />
</template>
