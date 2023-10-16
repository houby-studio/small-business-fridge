var express = require('express')
var router = express.Router()
var passport = require('passport')

// Who knows why it's there. Seems to be working without this file. Whatever.
router.get(
  '/',
  passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/login'
  }),
  function (req, res) {
    res.redirect('/')
  }
)

module.exports = router
