import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import app from '@adonisjs/core/services/app'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import type { InferSharedProps } from '@adonisjs/inertia/types'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { readFileSync, readdirSync } from 'node:fs'
import {
  applyCurrencyPlaceholder,
  getCurrencyCode,
  getCurrencyDisplay,
} from '#services/currency_service'

type ImpersonationSession = { byId: number; asId: number; asName: string }

const translationsCache = new Map<string, Record<string, Record<string, string>>>()

function loadTranslations(locale: string): Record<string, Record<string, string>> {
  if (app.inProduction) {
    const cached = translationsCache.get(locale)
    if (cached) return cached
  }

  const langDir = app.languageFilesPath(locale)
  const appName = env.get('APP_NAME', 'Small Business Fridge')

  try {
    const files = readdirSync(langDir).filter((file) => file.endsWith('.json'))
    const translations: Record<string, Record<string, string>> = {}

    for (const file of files) {
      const namespace = file.replace('.json', '')
      // The `{currency}` placeholder is resolved from config here, so the client never has
      // to pass a currency to t() — the same substitution runs server-side in start/i18n.ts.
      translations[namespace] = applyCurrencyPlaceholder(
        JSON.parse(readFileSync(`${langDir}/${file}`, 'utf-8')),
        locale
      )
      if (namespace === 'common') {
        translations[namespace].app_name = appName
      }
    }

    if (app.inProduction) {
      translationsCache.set(locale, translations)
    }

    return translations
  } catch {
    return {}
  }
}

export default class InertiaMiddleware extends BaseInertiaMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    await this.init(ctx)
    const output = await next()
    this.dispose(ctx)
    return output
  }

  async share(ctx: HttpContext) {
    const user = ctx.auth?.user
    const excludedAllergenRows = user
      ? await db
          .from('user_excluded_allergen')
          .where('user_id', user.id)
          .orderBy('allergen_id', 'asc')
          .select('allergen_id')
      : []

    const impersonation = ctx.session?.get('__impersonation') as ImpersonationSession | undefined
    const locale = ctx.i18n?.locale ?? 'cs'
    const currencyCode = getCurrencyCode()
    const currency = getCurrencyDisplay(locale)

    return {
      user: ctx.inertia.always(
        user
          ? {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              pendingEmail: user.pendingEmail,
              emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
              iban: user.iban,
              pendingIban: user.pendingIban,
              ibanVerifiedAt: user.ibanVerifiedAt?.toISO() ?? null,
              role: user.role,
              isKiosk: user.isKiosk,
              colorMode: user.colorMode,
              keypadId: user.keypadId,
              excludedAllergenIds: excludedAllergenRows.map((row) => Number(row.allergen_id)),
            }
          : undefined
      ),
      flash: ctx.inertia.always(ctx.session?.flashMessages.all() ?? {}),
      /**
       * Without this, `form.errors` is always empty, so Inertia treats a 302-back
       * validation failure as a success: onError never fires, onSuccess does, and
       * forms happily reset themselves over rejected input.
       */
      errors: ctx.inertia.always(this.getValidationErrors(ctx)),
      impersonation: ctx.inertia.always(
        impersonation ? { asName: impersonation.asName } : undefined
      ),
      locale,
      appName: env.get('APP_NAME', 'Small Business Fridge'),
      currencyCode,
      currency,
      translations: loadTranslations(locale),
    }
  }
}

declare module '@adonisjs/inertia/types' {
  interface SharedProps extends InferSharedProps<InertiaMiddleware> {}

  interface InertiaPages {
    [key: string]: Record<string, any>
  }
}
