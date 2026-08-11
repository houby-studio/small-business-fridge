import app from '@adonisjs/core/services/app'
import { ExceptionHandler } from '@adonisjs/core/http'
import type { HttpContext } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * Status pages are used to display a custom HTML pages for certain error
   * codes. You might want to enable them in production only, but feel
   * free to enable them in development as well.
   */
  protected renderStatusPages = app.inProduction

  /**
   * Status pages is a collection of error code range and a callback
   * to return the HTML contents to send as a response.
   */
  /**
   * `ctx.inertia` is set up by the Inertia middleware, which has to stay in the server
   * stack precisely because these pages render for requests that never matched a route.
   * The guard is defence in depth: if it is ever missing, answer plainly instead of
   * throwing from the error handler and turning every 404 into a 500.
   */
  private renderStatusPage(component: string, error: unknown, ctx: HttpContext) {
    if (!ctx.inertia) {
      // The status is not on the response yet at this point, so take it from the error.
      const status = (error as { status?: number } | null)?.status ?? 500
      return ctx.response.status(status).send(status === 404 ? 'Not found' : 'Server error')
    }

    return ctx.inertia.render(component, { error })
  }

  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (error, ctx) => this.renderStatusPage('errors/not_found', error, ctx),
    '500..599': (error, ctx) => this.renderStatusPage('errors/server_error', error, ctx),
  }

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
