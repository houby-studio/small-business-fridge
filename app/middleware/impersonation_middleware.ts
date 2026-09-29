import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import User from '#models/user'

export interface ImpersonationData {
  byId: number
  asId: number
  asName: string
}

/**
 * Impersonation middleware enables admins to act as another user.
 *
 * When session.__impersonation is set and the real authenticated user is admin,
 * this middleware overrides ctx.auth.user with the impersonated user for the
 * duration of the request. The session's actual auth remains the admin.
 */
export default class ImpersonationMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const impersonation = ctx.session?.get('__impersonation') as ImpersonationData | undefined

    if (
      impersonation &&
      ctx.auth.user?.id === impersonation.byId &&
      ctx.auth.user?.role === 'admin'
    ) {
      const target = await User.find(impersonation.asId)

      if (target && !target.isDisabled) {
        // Remember who is really acting, so the audit log can say so (AuditService).
        ctx.impersonator = { id: ctx.auth.user.id, displayName: ctx.auth.user.displayName }
        // Override the effective user — all downstream middleware and controllers
        // will see the impersonated user as auth.user.
        ;(ctx.auth.use('web') as unknown as { user: User }).user = target
      } else {
        // Target user no longer valid — cancel impersonation silently
        ctx.session.forget('__impersonation')
      }
    }

    return next()
  }
}

declare module '@adonisjs/core/http' {
  interface HttpContext {
    /** The admin actually behind this request while they impersonate another user. */
    impersonator?: { id: number; displayName: string }
  }
}
