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

    if (!req.query.customer) {
        res.status(400);
        res.render('error');
        return;
    }
    
    console.log('Yay a request!');
    User.findOne({ keypadId: req.query.customer }, function (err, user) {
        if (err) {
            res.status(err.status || 400);
            res.render('error');
            return;
        }
    res.render(user.email);
    });

});

module.exports = router;