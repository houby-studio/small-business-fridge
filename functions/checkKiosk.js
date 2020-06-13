module.exports = {

  // Checks if user is not a kiosk user, if kiosk, redirect to kiosk page.
  checkKiosk: function (req, res, next) {
    if (!req.user) {
      return next()
    }
    if (!req.user.kiosk) {
      return next()
    }
    res.redirect('/kiosk_keypad')
  }

}
