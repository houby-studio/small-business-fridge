import type { HttpContext } from '@adonisjs/core/http'

export default class AuthController {
  async login({ response }: HttpContext) {
    // TODO: Phase 2 — Authenticate via keypadId/card + API secret, return access token
    return response.json({ token: '' })
  }

  async token({ response }: HttpContext) {
    // TODO: Phase 2 — Authenticate via username + password, return access token
    return response.json({ token: '' })
  }
}
