var express = require('express')
var router = express.Router()
var passport = require('passport')

/* GET login page. */
router.get(
  '/',
  function (req, res, next) {
    passport.authenticate('azuread-openidconnect', {
      response: res,
      failureRedirect: '/'
    })(req, res, next)
  },
  function (req, res) {
    res.redirect('/')
  }
)

module.exports = router
