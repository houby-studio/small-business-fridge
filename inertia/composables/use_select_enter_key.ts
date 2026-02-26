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
  function focusSelectSearchField() {
    const filterInput = document.querySelector(
      '.p-select-overlay .p-select-filter'
    ) as HTMLInputElement | null
    if (!filterInput) return
    filterInput.focus()
    filterInput.select()
  }

  function selectTopOrFocusedOption(
    filterInput: HTMLInputElement,
    options: T[],
    getLabel: (option: T) => string,
    getValue: (option: T) => number | string
  ): number | string | null {
    const activeDescendantId = filterInput.getAttribute('aria-activedescendant')
    const activeDescendantOption = activeDescendantId
      ? (document.getElementById(activeDescendantId) as HTMLElement | null)
      : null
    const focusedOption = document.querySelector(
      '.p-select-overlay .p-select-option.p-focus, .p-select-overlay .p-select-option[data-p-focused="true"]'
    ) as HTMLElement | null
    const topOption = document.querySelector(
      '.p-select-overlay .p-select-option'
    ) as HTMLElement | null
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

    for (const binding of bindings) {
      if (binding.selectRef.value?.overlayVisible !== true) continue

      event.preventDefault()
      event.stopPropagation()

      const value = selectTopOrFocusedOption(
        event.target,
        binding.getOptions(),
        binding.getLabel,
        binding.getValue
      )
      if (value === null) return

      binding.onSelect(value)
      if (typeof binding.selectRef.value?.hide === 'function') {
        binding.selectRef.value.hide()
      }
      return
    }
  }

  function onSelectShow() {
    nextTick(() => focusSelectSearchField())
  }

  onMounted(() => document.addEventListener('keydown', onFilterSearchEnter, true))
  onBeforeUnmount(() => document.removeEventListener('keydown', onFilterSearchEnter, true))

  return { onSelectShow }
}
