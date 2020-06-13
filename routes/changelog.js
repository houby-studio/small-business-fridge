var express = require('express')
var router = express.Router()
var checkKiosk = require('../functions/checkKiosk').checkKiosk

/* GET changelog page. */
router.get('/', checkKiosk, function (req, res, next) {
  res.render('shop/changelog', {
    title: 'Changelog | Lednice IT',
    user: req.user
  })
})

module.exports = router
