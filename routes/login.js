var express = require('express')
var router = express.Router()
var passport = require('passport')
var config = require('../config/config')

/* GET account page. */
router.get('/',
  function (req, res, next) {
    passport.authenticate('azuread-openidconnect', {
      response: res, // required
      resourceURL: config.resourceURL, // optional. Provide a value if you want to specify the resource.
      customState: 'my_state', // optional. Provide a value if you want to provide custom state value.
      failureRedirect: '/'
    })(req, res, next)
  },
  function (req, res) {
    res.redirect('/')
  }
)

module.exports = router
