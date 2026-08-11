/*
|--------------------------------------------------------------------------
| HTTP kernel file
|--------------------------------------------------------------------------
|
| The HTTP kernel file is used to register the middleware with the server
| or the router.
|
*/

import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

/**
 * The error handler is used to convert an exception
 * to an HTTP response.
 */
server.errorHandler(() => import('#exceptions/handler'))

/**
 * The server middleware stack runs middleware on all the HTTP
 * requests, even if there is no route registered for
 * the request URL.
 */
server.use([
  () => import('#middleware/container_bindings_middleware'),
  () => import('#middleware/http_access_log_middleware'),
  () => import('#middleware/mcp_cors_middleware'),
  () => import('@adonisjs/cors/cors_middleware'),
  () => import('@adonisjs/vite/vite_middleware'),
  () => import('@adonisjs/static/static_middleware'),
  /**
   * Must live in the SERVER stack, not the router stack: the exception handler renders its
   * status pages through `ctx.inertia`, and those fire for requests that never matched a
   * route — where router middleware does not run at all. Registered any deeper, every 404
   * turned into a 500 from the error handler itself.
   *
   * The cost is that dispose() runs after the session commit, so its reflash on a 409
   * (stale asset version) is a no-op and a flash message can be lost across that forced
   * reload. A lost flash beats an unrenderable error page.
   */
  () => import('#middleware/inertia_middleware'),
])

/**
 * The router middleware stack runs middleware on all the HTTP
 * requests with a registered route.
 */
router.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('@adonisjs/session/session_middleware'),
  () => import('#middleware/cache_guard_middleware'),
  () => import('@adonisjs/shield/shield_middleware'),
  () => import('@adonisjs/auth/initialize_auth_middleware'),
  () => import('#middleware/silent_auth_middleware'),
  () => import('#middleware/impersonation_middleware'),
  () => import('#middleware/detect_user_locale_middleware'),
])

/**
 * Named middleware collection must be explicitly assigned to
 * the routes or the routes group.
 */
export const middleware = router.named({
  guest: () => import('#middleware/guest_middleware'),
  auth: () => import('#middleware/auth_middleware'),
  emailVerified: () => import('#middleware/email_verified_middleware'),
  role: () => import('#middleware/role_middleware'),
  kiosk: () => import('#middleware/kiosk_middleware'),
  kioskOnly: () => import('#middleware/kiosk_only_middleware'),
  throttle: () => import('#middleware/throttle_middleware'),
})
