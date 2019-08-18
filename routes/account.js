var express = require('express');
var router = express.Router();
var Product = require('../models/product');

function ensureAuthenticated(req, res, next) {
	if (req.isAuthenticated()) { return next(); }
	res.redirect('/login');
};

/* GET account page. */
router.get('/', ensureAuthenticated, function (req, res) {
    res.render('shop/account', { user: req.user });
});

module.exports = router;
