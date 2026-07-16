import { usePage } from '@inertiajs/vue3'
import { computed } from 'vue'

type TranslationsMap = Record<string, Record<string, string>>

/**
 * Vue composable for i18n translations.
 * Reads translations from Inertia shared data (loaded from resources/lang/).
 *
 * Usage:
 *   const { t, locale } = useI18n()
 *   t('common.save')           // "Uložit" or "Save"
 *   t('shop.confirm_message', { name: 'Cola', price: 15 })  // "Koupit Cola za 15 Kč?"
 */
export function useI18n() {
  const page = usePage()

  const locale = computed(() => (page.props.locale as string | undefined) ?? 'cs')
  const currency = computed(() => (page.props.currency as string | undefined) ?? '')

  const translations = computed(
    () => (page.props.translations as TranslationsMap | undefined) ?? {}
  )

  /**
   * Translate a key with optional parameter substitution.
   * Key format: "namespace.key" e.g. "common.save", "shop.confirm_message"
   */
  function t(key: string, params?: Record<string, string | number>): string {
    const dotIndex = key.indexOf('.')
    if (dotIndex === -1) return key

    const namespace = key.substring(0, dotIndex)
    const k = key.substring(dotIndex + 1)

    const value = translations.value?.[namespace]?.[k]
    if (value === undefined) return key

    const resolvedParams: Record<string, string | number> = {
      ...(currency.value ? { currency: currency.value } : {}),
      ...(params ?? {}),
    }

    // Simple {param} substitution
    return value.replace(/\{(\w+)\}/g, (_, p) => {
      return p in resolvedParams ? String(resolvedParams[p]) : `{${p}}`
    })
  }

  /**
   * Translate a key with pluralization support.
   * Translation value must be pipe-separated plural forms:
   *   - 2 forms:  "singular|plural"                     (English-style)
   *   - 3 forms:  "singular|few (2–4)|many (0, 5+)"     (Czech-style)
   *
   * Example CS:  "n_items_selected": "{count} položka|{count} položky|{count} položek"
   * Example EN:  "n_items_selected": "{count} item|{count} items"
   */
  function tp(key: string, count: number, params?: Record<string, string | number>): string {
    const dotIndex = key.indexOf('.')
    if (dotIndex === -1) return key

    const namespace = key.substring(0, dotIndex)
    const k = key.substring(dotIndex + 1)

    const rawValue = translations.value?.[namespace]?.[k]
    if (rawValue === undefined) return key

    const forms = rawValue.split('|')
    let form: string
    if (forms.length >= 3) {
      // Czech-style: 1 → singular, 2–4 → few, 0 / 5+ → many
      if (count === 1) form = forms[0]
      else if (count >= 2 && count <= 4) form = forms[1]
      else form = forms[2]
    } else if (forms.length === 2) {
      form = count === 1 ? forms[0] : forms[1]
    } else {
      form = forms[0]
    }

    const resolvedParams: Record<string, string | number> = {
      ...(currency.value ? { currency: currency.value } : {}),
      count,
      ...(params ?? {}),
    }

    return form.replace(/\{(\w+)\}/g, (_, p) => {
      return p in resolvedParams ? String(resolvedParams[p]) : `{${p}}`
    })
  }

  return { t, tp, locale }
}
