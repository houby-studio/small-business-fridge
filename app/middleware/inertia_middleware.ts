import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import app from '@adonisjs/core/services/app'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import type { InferSharedProps } from '@adonisjs/inertia/types'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { readFileSync, readdirSync } from 'node:fs'

type ImpersonationSession = { byId: number; asId: number; asName: string }

function loadTranslations(locale: string): Record<string, Record<string, string>> {
  const langDir = app.languageFilesPath(locale)
  const appName = env.get('APP_NAME', 'Small Business Fridge')

  try {
    const files = readdirSync(langDir).filter((file) => file.endsWith('.json'))
    const translations: Record<string, Record<string, string>> = {}

    for (const file of files) {
      const namespace = file.replace('.json', '')
      translations[namespace] = JSON.parse(readFileSync(`${langDir}/${file}`, 'utf-8'))
      if (namespace === 'common') {
        translations[namespace].app_name = appName
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

    return {
      user: user
        ? {
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            isKiosk: user.isKiosk,
            colorMode: user.colorMode,
            keypadId: user.keypadId,
            excludedAllergenIds: excludedAllergenRows.map((row) => Number(row.allergen_id)),
          }
        : null,
      flash: ctx.session?.flashMessages.all() ?? {},
      impersonation: impersonation ? { asName: impersonation.asName } : null,
      locale: ctx.i18n?.locale ?? 'cs',
      appName: env.get('APP_NAME', 'Small Business Fridge'),
      translations: loadTranslations(ctx.i18n?.locale ?? 'cs'),
    }
  }
}

declare module '@adonisjs/inertia/types' {
  interface SharedProps extends InferSharedProps<InertiaMiddleware> {}

  interface InertiaPages {
    [key: string]: Record<string, any>
  }
}
