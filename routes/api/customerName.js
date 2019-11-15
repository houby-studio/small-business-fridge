var express = require('express');
var router = express.Router();
// var moment = require('moment');
// var mailer = require('../../functions/sendMail');
// var config = require('../../config/config');
var User = require('../../models/user');
// var Order = require('../../models/order');
// var Product = require('../../models/product');
// var Delivery = require('../../models/delivery');


router.get('/', function (req,res, next) {

    console.log('Yay a request!');
    User.findOne({ keypadId: req.body.customer }, function (err, user) {
        if (err) {
            res.status(err.status || 500);
            res.render('error');
            return;
        }
    res.render(user.email);
    });

});

module.exports = router;