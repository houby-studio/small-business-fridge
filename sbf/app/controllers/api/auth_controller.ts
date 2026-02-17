import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { apiTokenLoginValidator, apiKeypadLoginValidator } from '#validators/auth'
import env from '#start/env'

export default class AuthController {
  /**
   * Login via keypadId or cardId + API secret.
   * Used by kiosk/scanner devices.
   */
  async login({ request, response }: HttpContext) {
    const { keypadId, cardId, apiSecret } = await request.validateUsing(apiKeypadLoginValidator)

    const configuredSecret = env.get('API_SECRET')
    if (!configuredSecret || apiSecret !== configuredSecret) {
      return response.unauthorized({ error: 'Invalid API secret.' })
    }

    if (!keypadId && !cardId) {
      return response.badRequest({ error: 'Either keypadId or cardId is required.' })
    }

    let user: User | null = null
    if (keypadId) {
      user = await User.findBy('keypadId', keypadId)
    } else if (cardId) {
      user = await User.findBy('cardId', cardId)
    }

    if (!user || user.isDisabled) {
      return response.unauthorized({ error: 'User not found or disabled.' })
    }

    const token = await User.accessTokens.create(user, ['*'], {
      name: 'kiosk-token',
      expiresIn: '24h',
    })

    return response.json({
      token: token.value!.release(),
      user: {
        id: user.id,
        displayName: user.displayName,
        keypadId: user.keypadId,
        role: user.role,
      },
    })
  }

  /**
   * Login via username + password.
   * Used by mobile apps or any API client.
   */
  async token({ request, response }: HttpContext) {
    const { username, password } = await request.validateUsing(apiTokenLoginValidator)

    try {
      const user = await User.verifyCredentials(username, password)

      if (user.isDisabled) {
        return response.unauthorized({ error: 'User account is disabled.' })
      }

      const token = await User.accessTokens.create(user, ['*'], {
        name: 'api-token',
        expiresIn: '30 days',
      })

      return response.json({
        token: token.value!.release(),
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
        },
      })
    } catch {
      return response.unauthorized({ error: 'Invalid credentials.' })
    }
  }
}
