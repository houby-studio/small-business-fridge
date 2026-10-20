import { onBeforeUnmount, watch, type Ref } from 'vue'

export const FILTER_SEARCH_DELAY_MS = 400

/**
 * A FilterBar text field that searches on the server as the user types (CLAUDE.md › Filter
 * Inputs): 400 ms after the last keystroke, at once on Enter or when the field is left.
 *
 * - The same text twice never sends a second request: not while the first is in flight, and
 *   not when it is what the page already shows (`getApplied`, the `filters` prop).
 * - A newer search replaces an older one in flight — Inertia cancels the running visit when
 *   the next one starts, so a slow answer can never overwrite a newer one.
 * - Only typing schedules a search (`onInput`), so resetting the field in code ("Clear")
 *   does not trigger one of its own.
 *
 * Template: `<InputText v-model="search" @input="onInput" @keydown.enter="flush" @blur="flush" />`
 */
export function useFilterSearch(
  search: Ref<string>,
  options: { apply: () => void; getApplied: () => string | null | undefined; delay?: number }
) {
  const delay = options.delay ?? FILTER_SEARCH_DELAY_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Text of the request in flight; cleared once the page shows its answer. */
  let requested: string | null = null

  const normalize = (value: string | null | undefined) => (value ?? '').trim()

  function cancelTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function flush() {
    cancelTimer()
    const value = normalize(search.value)
    if (value === requested) return
    if (requested === null && value === normalize(options.getApplied())) return
    requested = value
    options.apply()
  }

  function onInput() {
    cancelTimer()
    timer = setTimeout(flush, delay)
  }

  // The answer arrived (or another filter navigated): nothing of ours is in flight any more.
  watch(
    () => normalize(options.getApplied()),
    () => {
      requested = null
    }
  )

  onBeforeUnmount(cancelTimer)

  return { onInput, flush, cancel: cancelTimer }
}
