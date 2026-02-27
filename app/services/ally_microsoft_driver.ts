import { Oauth2Driver } from '@adonisjs/ally'
import type {
  AllyManagerDriverFactory,
  ApiRequestContract,
  Oauth2AccessToken,
  LiteralStringUnion,
  Oauth2DriverConfig,
  RedirectRequestContract,
} from '@adonisjs/ally/types'
import type { HttpContext } from '@adonisjs/core/http'

type MicrosoftScopes = 'openid'

type MicrosoftToken = Oauth2AccessToken

type MicrosoftDriverConfig = Oauth2DriverConfig & {
  scopes?: LiteralStringUnion<MicrosoftScopes>[]
  tenantId?: string
}

class MicrosoftDriver extends Oauth2Driver<MicrosoftToken, MicrosoftScopes> {
  protected authorizeUrl: string
  protected accessTokenUrl: string
  protected userInfoUrl = 'https://graph.microsoft.com/v1.0/me'
  protected codeParamName = 'code'
  protected errorParamName = 'error'
  protected stateCookieName = 'microsoft_oauth_state'
  protected stateParamName = 'state'
  protected scopeParamName = 'scope'
  protected scopesSeparator = ' '

  constructor(
    ctx: HttpContext,
    public config: MicrosoftDriverConfig
  ) {
    super(ctx, config)
    const tenantId = this.config.tenantId || 'common'
    this.authorizeUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`
    this.accessTokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
    this.loadState()
  }

  protected configureRedirectRequest(request: RedirectRequestContract<MicrosoftScopes>): void {
    request.scopes(this.config.scopes || ['openid'])
    request.param('response_type', 'code')
  }

  protected configureAccessTokenRequest(request: ApiRequestContract): void {
    request
      .header('Content-Type', 'application/x-www-form-urlencoded')
      .field('grant_type', 'authorization_code')
      .field('client_id', this.config.clientId)
      .field('client_secret', this.config.clientSecret)
      .field('redirect_uri', this.config.callbackUrl)
      .field('code', this.ctx.request.input(this.codeParamName))
  }

  accessDenied(): boolean {
    const error = this.getError()
    return error === 'access_denied'
  }

  async user(callback?: (request: ApiRequestContract) => void): Promise<any> {
    const accessToken = await this.accessToken(callback)
    const user = await this.getUserInfo(accessToken.token, callback)
    return {
      ...user,
      token: accessToken,
    }
  }

  async userFromToken(
    token: string,
    callback?: (request: ApiRequestContract) => void
  ): Promise<any> {
    const user = await this.getUserInfo(token, callback)
    return {
      ...user,
      token: { token, type: 'bearer' },
    }
  }

  protected async getUserInfo(
    accessToken: string,
    callback?: (request: ApiRequestContract) => void
  ): Promise<any> {
    const request = this.getAuthenticatedRequest(this.userInfoUrl, accessToken)
    callback?.(request)
    return (request as any).get()
  }

  protected getAuthenticatedRequest(url: string, token: string): ApiRequestContract {
    const request = this.httpClient(url)
    request.header('Authorization', `Bearer ${token}`)
    request.parseAs('json')
    return request
  }
}

export function microsoft(config: MicrosoftDriverConfig): AllyManagerDriverFactory {
  return (ctx) => new MicrosoftDriver(ctx, config)
}
