import { defineConfig } from '@adonisjs/inertia'
import type { InferSharedProps } from '@adonisjs/inertia/types'
import { readFileSync, readdirSync } from 'node:fs'
import app from '@adonisjs/core/services/app'

/**
 * Load all translation JSON files for a given locale.
 * Returns a flat object keyed by namespace (filename without .json).
 */
function loadTranslations(locale: string): Record<string, Record<string, string>> {
  const langDir = app.languageFilesPath(locale)
  try {
    const files = readdirSync(langDir).filter((f) => f.endsWith('.json'))
    const translations: Record<string, Record<string, string>> = {}

    for (const file of files) {
      const namespace = file.replace('.json', '')
      translations[namespace] = JSON.parse(readFileSync(`${langDir}/${file}`, 'utf-8'))
    }

    return translations
  } catch {
    return {}
  }
}

const inertiaConfig = defineConfig({
  /**
   * Path to the Edge view that will be used as the root view for Inertia responses
   */
  rootView: 'inertia_layout',

  /**
   * Data that should be shared with all rendered pages
   */
  sharedData: {
    user: (ctx) =>
      ctx.inertia.always(() => {
        if (!ctx.auth?.user) return null
        return {
          id: ctx.auth.user.id,
          displayName: ctx.auth.user.displayName,
          email: ctx.auth.user.email,
          role: ctx.auth.user.role,
          isKiosk: ctx.auth.user.isKiosk,
          colorMode: ctx.auth.user.colorMode,
          keypadId: ctx.auth.user.keypadId,
        }
      }),
    flash: (ctx) =>
      ctx.inertia.always(() => {
        return ctx.session?.flashMessages.all() ?? {}
      }),
    locale: (ctx) => ctx.i18n?.locale ?? 'cs',
    translations: (ctx) => {
      const locale = ctx.i18n?.locale ?? 'cs'
      return loadTranslations(locale)
    },
  },

  /**
   * Options for the server-side rendering
   */
  ssr: {
    enabled: true,
    entrypoint: 'inertia/app/ssr.ts',
  },
})

export default inertiaConfig

declare module '@adonisjs/inertia/types' {
  export interface SharedProps extends InferSharedProps<typeof inertiaConfig> {}
}
