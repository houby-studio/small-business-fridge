import { onMounted, onUnmounted } from 'vue'

/**
 * Focuses a field once the page can take focus. On a full page load the app shell stays
 * `visibility: hidden` behind the boot loader for a moment, and a hidden element ignores
 * focus() — fixed delays miss it. Retries until the field is focused, and gives up as soon
 * as the user has put the focus somewhere else themselves.
 */
export function useInitialFocus(getElement: () => HTMLElement | null, timeoutMs = 3000) {
  let timer: number | undefined
  const started = Date.now()

  function attempt() {
    const element = getElement()
    const active = document.activeElement
    const userMovedOn = active && active !== document.body && active !== element
    if (!element || userMovedOn || Date.now() - started > timeoutMs) return
    element.focus()
    if (document.activeElement !== element) timer = window.setTimeout(attempt, 100)
  }

  onMounted(attempt)
  onUnmounted(() => window.clearTimeout(timer))
}
