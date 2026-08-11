import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Kiosk-only middleware restricts the kiosk endpoints to the dedicated kiosk account.
 *
 * These endpoints act on behalf of an arbitrary customer — the customer id travels
 * in the request payload — so authentication alone is not enough: any signed-in user
 * could otherwise order onto somebody else's account.
 *
 * This is the counterpart of KioskMiddleware, which keeps kiosk accounts *out* of the
 * regular UI. That one does not imply this one.
 */
export default class KioskOnlyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (!ctx.auth.user?.isKiosk) {
      if (ctx.request.accepts(['html', 'json']) === 'json') {
        return ctx.response.status(403).json({ error: 'forbidden' })
      }

      ctx.session.flash('alert', {
        type: 'danger',
        message: ctx.i18n.t('messages.unauthorized'),
      })
      return ctx.response.redirect('/')
    }

    return next()
  }
}
