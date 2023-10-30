import logger from './logger.js'

export function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  logger.info(
    'server.functions.ensureauthenticated__Redirecting unauthenticated request to /login page.'
  )
  const originalUrl = encodeURIComponent(req.originalUrl)
  res.redirect(`/login?originalUrl=${originalUrl}`)
}
