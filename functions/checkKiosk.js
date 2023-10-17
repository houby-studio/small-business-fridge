export function checkKiosk(req, res, next) {
  if (!req.user) {
    return next()
  }
  if (!req.user.kiosk) {
    return next()
  }
  res.redirect('/kiosk_keypad')
}
