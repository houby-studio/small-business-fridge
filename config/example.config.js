exports.config = {

  app: {

    port: 3000

  },

  db: {

    connstr: 'mongodb://testusr:testpwd@localhost:27017/smallbusinessfridge'

  },

  cookie_secret: 'verysecretverysecretverysecretverysecretverysecretoh',
  parser_secret: 'ohverysecretverysecretverysecretverysecretverysecret',
  api_secret: 'veryveryverysecretapikey',
  debug: false
}

exports.mail = {

  port: 25,
  host: 'localhost',
  from: 'Lednice IT<noreply@example.com>',
  system: 'helpdesk@example.com'

}

// Creds object containing passport openID configuration

exports.creds = {

  // Required
  identityMetadata: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
  // or you can use the common endpoint
  // 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration'
  // To use the common endpoint, you have to either turn `validateIssuer` off, or provide the `issuer` value.

  // Required, the client ID of your app in AAD - dummy application with no permissions for testing purposes
  clientID: 'replacewithclientid',

  // Required, must be 'code', 'code id_token', 'id_token code' or 'id_token'
  // If you want to get access_token, you must use 'code', 'code id_token' or 'id_token code'
  responseType: 'id_token',

  // Required
  responseMode: 'form_post',

  // Required, the reply URL registered in AAD for your app
  redirectUrl: 'https://localhost/auth/openid/return',

  // Required if we use http for redirectUrl
  allowHttpForRedirectUrl: false,

  // Required if `responseType` is 'code', 'id_token code' or 'code id_token'.
  // If app key contains '\', replace it with '\\'.
  clientSecret: 'rtdo:@-required-if-code-is-needed',

  // Required to set to false if you don't want to validate issuer
  validateIssuer: false,

  // Required if you want to provide the issuer(s) you want to validate instead of using the issuer from metadata
  // issuer could be a string or an array of strings of the following form: 'https://sts.windows.net/<tenant_guid>/v2.0'
  // issuer: null,

  // Required to set to true if the `verify` function has 'req' as the first parameter
  passReqToCallback: false,

  // Recommended to set to true. By default we save state in express session, if this option is set to true, then
  // we encrypt state and save it in cookie instead. This option together with { session: false } allows your app
  // to be completely express session free.
  useCookieInsteadOfSession: true,

  // Required if `useCookieInsteadOfSession` is set to true. You can provide multiple set of key/iv pairs for key
  // rollover purpose. We always use the first set of key/iv pair to encrypt cookie, but we will try every set of
  // key/iv pair to decrypt cookie. Key can be any string of length 32, and iv can be any string of length 12.
  cookieEncryptionKeys: [

    {
      key: 'thiskeyhastobethirtytwobyteslong',
      iv: 'disbeshorter'
    }

  ],

  // The additional scopes we want besides 'openid'.
  // 'profile' scope is required, the rest scopes are optional.
  // (1) if you want to receive refresh_token, use 'offline_access' scope
  // (2) if you want to get access_token for graph api, use the graph api url like 'https://graph.microsoft.com/mail.read'
  scope: ['profile', 'offline_access', 'email'],

  // Optional, 'error', 'warn' or 'info'
  loggingLevel: 'info',

  // Optional. The lifetime of nonce in session or cookie, the default value is 3600 (seconds).
  nonceLifetime: null,

  // Optional. The max amount of nonce saved in session or cookie, the default value is 10.
  nonceMaxAmount: 5,

  // Optional. The clock skew allowed in token validation, the default value is 300 seconds.
  clockSkew: null,

  destroySessionUrl: '/'

}
