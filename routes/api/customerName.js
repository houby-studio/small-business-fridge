var express = require('express');
var router = express.Router();
var config = require('../../config/config.js');
var User = require('../../models/user');

// GET /api/customerName - accepts customer's keypadId and returns customer's display name
router.get('/', function (req, res, next) {

    // Check if request contains 'customer' parameter and header with API secret key
    if (!req.query.customer || req.get('sbf-API-secret') != config.config.api_secret) {
        res.status(400);
        res.set('Content-Type', 'text/html');
        res.send('<h1>Bad request sent!</h1><p>Refer to documentation https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerName</p>');
        return;
    }

    // Find user in database
    User.findOne({
        keypadId: req.query.customer
    }, function (err, user) {
        if (err) {
            res.status(400);
            res.set('Content-Type', 'text/html');
            res.send('<h1>Bad request sent!</h1><p>Refer to documentation https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerName</p>');
            return;
        }

        // If database doesn't contain user with supplied keypadId, database returns empty object, which doesn't contain parameter displayName.
        res.set('Content-Type', 'application/json');
        if (!user.displayName) {
            res.status(404);
            res.json('NOT_FOUND');
        } else {
            res.status(200);
            res.json(user.displayName);
            console.log(user.displayName);
        }
    });
});

module.exports = router;