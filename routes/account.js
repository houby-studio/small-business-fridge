var express = require('express');
var router = express.Router();
var Product = require('../models/product');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

/* GET account page. */
router.get('/', ensureAuthenticated, function (req, res) {
    res.render('shop/account', { user: req.user });
});

module.exports = router;
