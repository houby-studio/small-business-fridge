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

  const locale = computed(() => (page.props as any).locale as string ?? 'cs')

  const translations = computed(() => (page.props as any).translations as TranslationsMap ?? {})

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

    if (!params) return value

    // Simple {param} substitution
    return value.replace(/\{(\w+)\}/g, (_, p) => {
      return p in params ? String(params[p]) : `{${p}}`
    })
  }

  return { t, locale }
}
