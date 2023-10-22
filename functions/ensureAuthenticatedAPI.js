import logger from './logger.js'

export function ensureAuthenticatedAPI(req, res, next) {
  if (!process.env.API_SECRET) {
    // Check if request header contains API secret key
    logger.warn(
      'server.functions.ensureauthenticatedapi__Blocked API request, because API is disabled, no API key is set.'
    )
    res.status(409).send()
    return
  }
  if (req.get('sbf-API-secret') !== process.env.API_SECRET) {
    // Check if request header contains API secret key
    logger.warn(
      'server.functions.ensureauthenticatedapi__Blocked API request without valid API key.'
    )
    res.status(401)
    res.set('Content-Type', 'application/problem+json')
    const responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#api-protection',
      title: 'Your request does not contain secret key.',
      status: 401,
      'detail:':
        'This is not a public function. To use this API, you need to supply secret key in the header. More details can be found in documentation https://git.io/Jeodr'
    }
    res.json(responseJson)
    return
  }
  return next()
}
