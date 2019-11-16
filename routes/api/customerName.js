var express = require('express');
var router = express.Router();
var config = require('../../config/config.js');
var User = require('../../models/user');

router.get('/', function (req, res, next) {

    if (!req.query.customer) {
        res.status(400);
        res.set('Content-Type', 'text/html');
        res.send('<h1>Bad request sent!</h1><p>Refer to documentation https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerName</p>');
        return;
    }

    if (req.get('apiKey') == config.config.api_secret) {
        console.log('Secret key OK');
    }

    console.log('Yay a request!');
    User.findOne({
        keypadId: req.query.customer
    }, function (err, user) {
        if (err) {
            res.status(err.status || 400);
            res.send('NOT_FOUND');
            return;
        }
        console.log(user.email);
        res.set('Content-Type', 'application/json');
        res.json(user.email);
    });

});

module.exports = router;