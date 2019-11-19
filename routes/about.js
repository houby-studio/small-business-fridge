var express = require('express')
var router = express.Router()

/* GET about page. */
router.get('/', function (req, res, next) {
  res.render('shop/about', {
    title: 'O aplikaci | Lednice IT',
    user: req.user
  })
})

module.exports = router
