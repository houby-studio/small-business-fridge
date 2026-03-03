import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import EmailVerificationService from '#services/email_verification_service'

export default class EmailVerifiedMiddleware {
  private verifications = new EmailVerificationService()

  private isAllowedPath(path: string) {
    return (
      path.startsWith('/profile') ||
      path.startsWith('/logout') ||
      path.startsWith('/email/verify') ||
      path.startsWith('/auth/')
    )
  }

  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user
    if (!user) {
      return next()
    }

    if (this.isAllowedPath(ctx.request.url())) {
      return next()
    }

    if (this.verifications.shouldBlockAppAccess(user)) {
      ctx.session.flash('alert', {
        type: 'warning',
        message: ctx.i18n.t('messages.email_verification_required'),
      })
      return ctx.response.redirect('/profile')
    }

    return next()
  }
}
