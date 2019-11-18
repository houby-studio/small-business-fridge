var express = require('express')
var router = express.Router()
var config = require('../config/config')

// 'logout' route, logout from passport, and destroy the session with AAD.
router.get('/', function (req, res) {
  req.session.destroy(function (_err) {
    req.logOut()
    res.redirect(config.creds.destroySessionUrl)
  })
})

module.exports = router
