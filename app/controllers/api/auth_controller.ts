import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { apiTokenLoginValidator, apiKeypadLoginValidator } from '#validators/auth'
import env from '#start/env'
import EmailVerificationService from '#services/email_verification_service'
import type { KioskTokenResponse, TokenResponse } from '#interfaces/api_responses'

export default class AuthController {
  private verifications = new EmailVerificationService()
  /**
   * @login
   * @summary Kiosk login (keypad/card ID)
   * @description Authenticates a kiosk device user by keypadId or cardId plus the shared API secret. Returns a short-lived token valid for 24 hours.
   * @tag Auth
   * @requestBody <KioskLoginRequest>
   * @responseBody 200 - <KioskTokenResponse>
   * @responseBody 400 - <ApiErrorResponse>
   * @responseBody 401 - <ApiErrorResponse>
   * @noAuth true
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

    // Honour the user's own "disable keypad sign-in" preference on both identifiers —
    // the keypad and the card are the two ways this endpoint identifies somebody.
    if (user.keypadDisabled) {
      return response.unauthorized({ error: 'Keypad sign-in is disabled for this user.' })
    }

    const token = await User.accessTokens.create(user, ['*'], {
      name: 'kiosk-token',
      expiresIn: '24h',
    })

    const payload: KioskTokenResponse = {
      token: token.value!.release(),
      user: {
        id: user.id,
        displayName: user.displayName,
        keypadId: user.keypadId,
        role: user.role,
      },
    }
    return response.json(payload)
  }

  /**
   * @token
   * @summary Obtain a personal API token
   * @description Authenticates with email and password, returns a Bearer token valid for 30 days.
   * @tag Auth
   * @requestBody <TokenLoginRequest>
   * @responseBody 200 - <TokenResponse>
   * @responseBody 401 - <ApiErrorResponse>
   * @noAuth true
   */
  async token({ request, response }: HttpContext) {
    const { email, password } = await request.validateUsing(apiTokenLoginValidator)

    try {
      const user = await User.verifyCredentials(email, password)

      if (user.isDisabled) {
        return response.unauthorized({ error: 'User account is disabled.' })
      }
      if (this.verifications.shouldBlockAppAccess(user)) {
        return response.unauthorized({ error: 'Email address is not verified yet.' })
      }

      const token = await User.accessTokens.create(user, ['*'], {
        name: 'api-token',
        expiresIn: '30 days',
      })

      const payload: TokenResponse = {
        token: token.value!.release(),
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
        },
      }
      return response.json(payload)
    } catch {
      return response.unauthorized({ error: 'Invalid credentials.' })
    }
  }
}
