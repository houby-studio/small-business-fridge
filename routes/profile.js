var express = require('express');
var router = express.Router();
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

/* GET about page. */
router.get('/', ensureAuthenticated, function(req, res, next) {
      res.render('shop/profile', { title: 'Profil | Lednice IT', user: req.user });
});

module.exports = router;