var express = require('express');
var router = express.Router();
var ensureAuthenticated = require('../../functions/ensureAuthenticated').ensureAuthenticated;

router.post('/', ensureAuthenticated, function (req, res) {

    console.log(req.body);
    console.log(req.user);
    var return_message = 'success';
    res.redirect('/add_products');

});

module.exports = router;
