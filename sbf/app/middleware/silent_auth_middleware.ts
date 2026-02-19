import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Silent auth middleware can be used as a global middleware to silent check
 * if the user is logged-in or not.
 *
 * The request continues as usual, even when the user is not logged-in.
 */
export default class SilentAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    await ctx.auth.check()

    // If the session resolves a disabled user (e.g. placeholder left by migration),
    // log them out so they are treated as unauthenticated on this and future requests.
    if (ctx.auth.user?.isDisabled) {
      await ctx.auth.use('web').logout()
    }

    return next()
  }
}
