var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('shop/changelog', {
    title: 'Changelog | Lednice IT',
    user: req.user
  });
});

module.exports = router;