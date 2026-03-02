import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import app from '@adonisjs/core/services/app'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import type { InferSharedProps } from '@adonisjs/inertia/types'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { readFileSync, readdirSync } from 'node:fs'
import { getCurrencyCode, getCurrencyDisplay } from '#services/currency_service'

type ImpersonationSession = { byId: number; asId: number; asName: string }

function loadTranslations(locale: string): Record<string, Record<string, string>> {
  const langDir = app.languageFilesPath(locale)
  const appName = env.get('APP_NAME', 'Small Business Fridge')
  const currencyDisplay = getCurrencyDisplay(locale)

  try {
    const files = readdirSync(langDir).filter((file) => file.endsWith('.json'))
    const translations: Record<string, Record<string, string>> = {}

    for (const file of files) {
      const namespace = file.replace('.json', '')
      translations[namespace] = JSON.parse(readFileSync(`${langDir}/${file}`, 'utf-8'))
      if (namespace === 'common') {
        translations[namespace].app_name = appName
        translations[namespace].currency = currencyDisplay
        translations[namespace].price_with_currency = `{price} ${currencyDisplay}`
        const pieceUnit = translations[namespace].pieces ?? ''
        translations[namespace].per_piece = pieceUnit
          ? `{price} ${currencyDisplay}/${pieceUnit}`
          : `{price} ${currencyDisplay}`
      }
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
              role: user.role,
              isKiosk: user.isKiosk,
              colorMode: user.colorMode,
              keypadId: user.keypadId,
              excludedAllergenIds: excludedAllergenRows.map((row) => Number(row.allergen_id)),
            }
          : undefined
      ),
      flash: ctx.inertia.always(ctx.session?.flashMessages.all() ?? {}),
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
