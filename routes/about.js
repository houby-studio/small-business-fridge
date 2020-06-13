var express = require('express')
var router = express.Router()
var checkKiosk = require('../functions/checkKiosk').checkKiosk

/* GET about page. */
router.get('/', checkKiosk, function (req, res, next) {
  res.render('shop/about', {
    title: 'O aplikaci | Lednice IT',
    user: req.user
  })
})

module.exports = router
