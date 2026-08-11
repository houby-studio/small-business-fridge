/*
|--------------------------------------------------------------------------
| Currency placeholder substitution
|--------------------------------------------------------------------------
|
| Translation strings carry a `{currency}` placeholder rather than a hard-coded symbol,
| so a deployment with CURRENCY=EUR does not mail out amounts in crowns. The client gets
| the substitution in app/middleware/inertia_middleware.ts; this does the same for every
| server-side consumer — flash messages, Edge mail templates, scheduled report mails.
|
| getTranslations() hands back the cached object by reference, so mutating the entries in
| place is enough for i18nManager.locale(...).t() and ctx.i18n.t() to see the result.
|
*/

import i18nManager from '@adonisjs/i18n/services/main'
import { applyCurrencyPlaceholder } from '#services/currency_service'

const translations = i18nManager.getTranslations()

for (const [locale, messages] of Object.entries(translations)) {
  Object.assign(messages, applyCurrencyPlaceholder(messages, locale))
}
