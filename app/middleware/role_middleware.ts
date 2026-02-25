import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Role middleware checks that the authenticated user has the required role.
 * Admin role implicitly includes supplier permissions.
 */
export default class RoleMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { roles: ('admin' | 'supplier')[] }) {
    const user = ctx.auth.user!
    const roles = options.roles

    const hasRole = roles.some((role) => {
      if (role === 'supplier') {
        return user.role === 'supplier' || user.role === 'admin'
      }
      return user.role === role
    })

    if (!hasRole) {
      ctx.session.flash('alert', {
        type: 'danger',
        message: ctx.i18n.t('messages.unauthorized'),
      })
      return ctx.response.redirect('/')
    }

    return next()
  }
}
