var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  if (req.session.alert) {
    var alert = req.session.alert;
    delete req.session.alert;
  }
  res.render('shop/index', { title: 'Index | Lednice IT', user: req.user, alert: alert });
});

module.exports = router;
