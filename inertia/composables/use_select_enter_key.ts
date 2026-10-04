import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'

interface SelectBinding<T> {
  /** Template ref to the PrimeVue Select component */
  selectRef: Ref<any>
  /** Reactive or plain option list — evaluated at event time */
  getOptions: () => T[]
  getLabel: (option: T) => string
  getValue: (option: T) => number | string
  onSelect: (value: number | string) => void
}

/**
 * The overlay element of an open PrimeVue Select (`instance.overlay`, set while the panel is
 * mounted). Null once the panel starts closing.
 */
function overlayOf(instance: any): HTMLElement | null {
  const overlay = instance?.overlay
  return overlay instanceof HTMLElement ? overlay : null
}

/**
 * The panel to work in when no Select instance tells us: the newest one that is not fading
 * out. A closed Select's overlay stays in the DOM for the length of its leave transition, so
 * "the first `.p-select-overlay` in the document" may well be the previous one.
 */
function newestLiveOverlay(): HTMLElement | null {
  const overlays = [...document.querySelectorAll<HTMLElement>('.p-select-overlay')].filter(
    (el) => ![...el.classList].some((cls) => cls.endsWith('-leave-active'))
  )
  return overlays[overlays.length - 1] ?? null
}

/**
 * Handles the PrimeVue Select "press Enter to confirm search" pattern.
 *
 * Eliminates ~90 lines of identical focusSelectSearchField + selectTopOrFocusedOption +
 * onFilterSearchEnter + onMounted/onBeforeUnmount boilerplate per page.
 *
 * Usage:
 *   const buyerSelect = ref(null)
 *   const { onSelectShow } = useSelectEnterKey([
 *     {
 *       selectRef: buyerSelect,
 *       getOptions: () => buyerOptions.value,
 *       getLabel: (o) => o.displayName,
 *       getValue: (o) => o.id,
 *       onSelect: (v) => { filterBuyerId.value = v },
 *     },
 *   ])
 *
 *   // Template: <Select ref="buyerSelect" ... @show="onSelectShow" />
 */
export function useSelectEnterKey<T>(bindings: SelectBinding<T>[]) {
  function openBinding(): SelectBinding<T> | null {
    return bindings.find((binding) => binding.selectRef.value?.overlayVisible === true) ?? null
  }

  function focusSelectSearchField() {
    const overlay = overlayOf(openBinding()?.selectRef.value) ?? newestLiveOverlay()
    const filterInput = overlay?.querySelector<HTMLInputElement>('.p-select-filter') ?? null
    if (!filterInput) return
    filterInput.focus()
    filterInput.select()
  }

  function selectTopOrFocusedOption(
    filterInput: HTMLInputElement,
    overlay: HTMLElement,
    options: T[],
    getLabel: (option: T) => string,
    getValue: (option: T) => number | string
  ): number | string | null {
    const activeDescendantId = filterInput.getAttribute('aria-activedescendant')
    const activeDescendantOption = activeDescendantId
      ? (overlay.querySelector(`[id="${activeDescendantId}"]`) as HTMLElement | null)
      : null
    const focusedOption = overlay.querySelector(
      '.p-select-option.p-focus, .p-select-option[data-p-focused="true"]'
    ) as HTMLElement | null
    const topOption = overlay.querySelector('.p-select-option') as HTMLElement | null
    const option = activeDescendantOption ?? focusedOption ?? topOption

    const optionLabel = option?.textContent?.trim()
    const query = filterInput.value.trim().toLocaleLowerCase()

    const matchedByHighlight = optionLabel
      ? options.find((item) => getLabel(item) === optionLabel)
      : null
    const matchedByQuery = options.find((item) =>
      getLabel(item).toLocaleLowerCase().includes(query)
    )
    const matched = matchedByHighlight ?? matchedByQuery ?? options[0]

    return matched ? getValue(matched) : null
  }

  function onFilterSearchEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter') return
    if (!(event.target instanceof HTMLInputElement)) return
    if (!event.target.classList.contains('p-select-filter')) return

    // Only ever look inside the panel the key was pressed in — never in another Select's
    // overlay that is still fading out next to it.
    const overlay = event.target.closest<HTMLElement>('.p-select-overlay')
    if (!overlay) return

    const binding =
      bindings.find((candidate) => overlayOf(candidate.selectRef.value) === overlay) ??
      openBinding()
    if (!binding) return

    event.preventDefault()
    event.stopPropagation()

    const value = selectTopOrFocusedOption(
      event.target,
      overlay,
      binding.getOptions(),
      binding.getLabel,
      binding.getValue
    )
    if (value === null) return

    binding.onSelect(value)
    const instance = binding.selectRef.value
    if (typeof instance?.hide === 'function') instance.hide()
  }

  function onSelectShow() {
    nextTick(() => focusSelectSearchField())
  }

  onMounted(() => document.addEventListener('keydown', onFilterSearchEnter, true))
  onBeforeUnmount(() => document.removeEventListener('keydown', onFilterSearchEnter, true))

  return { onSelectShow }
}
