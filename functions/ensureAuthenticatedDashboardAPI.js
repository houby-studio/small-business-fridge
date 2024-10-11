import logger from './logger.js'

export function ensureAuthenticatedDashboardAPI(req, res, next) {
  if (process.env.DASHBOARD_API_ENABLED.toLowerCase() !== 'true') {
    logger.warn(
      'server.functions.ensureauthenticateddashboardapi__Blocked Dashboard API request, because Dashboard API is disabled.'
    )
    res.status(403).send()
    return
  }
  if (
    process.env.DASHBOARD_API_SECRET.length !== 0 &&
    req.get('sbf-DASHAPI-secret') !== process.env.DASHBOARD_API_SECRET &&
    req.query?.key !== process.env.DASHBOARD_API_SECRET
  ) {
    // Check if request header contains API secret key
    logger.warn(
      'server.functions.ensureauthenticateddashboardapi__Blocked API request without valid API key.'
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
