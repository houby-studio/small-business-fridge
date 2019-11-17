var Product = require('../models/product');
var User = require('../models/user');
var Delivery = require('../models/delivery');
var config = require('../config/config');
var mongoose = require('mongoose');

mongoose.connect(config.config.db.connstr, {
    useNewUrlParser: true
});

function exit() {
    mongoose.disconnect();
}

User.findOne({}, function (err, dbuser) {
    if (err) {
        console.log(err);
        exit(1);
    }
    Product.findOne({}, function (err, dbproduct) {
        if (err) {
            console.log(err);
            exit(1);
        }
        var deliveries = [
            new Delivery({
                supplierId: dbuser,
                productId: dbproduct,
                amount_supplied: 5,
                amount_left: 5,
                price: 25
            })
        ];

        var done = 0;
        for (var i = 0; i < deliveries.length; i++) {
            deliveries[i].save(function (err, result) {
                done++;
                if (done === deliveries.length) {
                    exit();
                }
            });
        }
    });
});