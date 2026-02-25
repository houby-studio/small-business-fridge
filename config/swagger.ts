import path from 'node:path'
import url from 'node:url'
import env from '#start/env'

const appName = env.get('APP_NAME', 'Small Business Fridge')

const config = {
  path: path.dirname(url.fileURLToPath(import.meta.url)) + '/../',
  title: `${appName} API`,
  version: '1.0.0',
  description:
    `REST API for the Small Business Fridge (${appName}) self-service shop system. ` +
    'Authenticate with a Bearer token obtained from the profile page or via POST /api/v1/auth/token.',
  tagIndex: 3,
  snakeCase: true,
  debug: false,
  ignore: [],
  preferredPutPatch: 'PUT',
  authMiddlewares: ['auth'],
  defaultSecurityScheme: 'BearerAuth',
  persistAuthorization: true,
  securitySchemes: {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'opaque',
      description: 'Personal API token — create one on your profile page.',
    },
  },
  common: {
    headers: {},
    parameters: {},
  },
}

export default config
