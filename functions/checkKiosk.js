import logger from './logger.js'

export function checkKiosk(req, res, next) {
  if (!req.user) {
    return next()
  }
  if (!req.user.kiosk) {
    return next()
  }
  logger.warn('server.functions.checkkiosk__Redirecting kiosk user to keypad.')
  res.redirect('/kiosk_keypad')
}
