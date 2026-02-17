import type { HttpContext } from '@adonisjs/core/http'

export default class OidcController {
  async redirect({ response }: HttpContext) {
    // TODO: Phase 2 — Implement OIDC redirect to Microsoft Entra ID
    return response.redirect('/login')
  }

  async callback({ response }: HttpContext) {
    // TODO: Phase 2 — Handle OIDC callback, find-or-create user, login
    return response.redirect('/shop')
  }
}
