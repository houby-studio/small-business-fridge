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

type DiscordScopes = 'identify' | 'email'
type DiscordToken = Oauth2AccessToken

type DiscordDriverConfig = Oauth2DriverConfig & {
  scopes?: LiteralStringUnion<DiscordScopes>[]
}

class DiscordDriver extends Oauth2Driver<DiscordToken, DiscordScopes> {
  protected authorizeUrl = 'https://discord.com/oauth2/authorize'
  protected accessTokenUrl = 'https://discord.com/api/oauth2/token'
  protected userInfoUrl = 'https://discord.com/api/users/@me'
  protected codeParamName = 'code'
  protected errorParamName = 'error'
  protected stateCookieName = 'discord_oauth_state'
  protected stateParamName = 'state'
  protected scopeParamName = 'scope'
  protected scopesSeparator = ' '

  constructor(
    ctx: HttpContext,
    public config: DiscordDriverConfig
  ) {
    super(ctx, config)
    this.loadState()
  }

  protected configureRedirectRequest(request: RedirectRequestContract<DiscordScopes>): void {
    request.scopes(this.config.scopes || ['identify', 'email'])
    request.param('response_type', 'code')
    request.param('prompt', 'consent')
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
    return this.getError() === 'access_denied'
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

export function discord(config: DiscordDriverConfig): AllyManagerDriverFactory {
  return (ctx) => new DiscordDriver(ctx, config)
}
