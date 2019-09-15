var express = require('express');
var router = express.Router();
var moment = require('moment');
var mailer = require('../../functions/sendMail');
var config = require('../../config/config');
var User = require('../../models/user');
var Order = require('../../models/order');
var Product = require('../../models/product');
var Delivery = require('../../models/delivery');

/* GET about page. */
router.post('/', function(req, res, next) {

    if (req.body.secret != config.config.api_secret) {
        res.status(err.status || 500);
        res.render('error');
        return;
    }

    var newOrder = new Order();

    // Find user by keypadId -- probably unneeded and can be found during aggregation below
    User.findOne({ keypadId: req.body.customer }, function (err, user) {
        if (err) {
            res.status(err.status || 500);
            res.render('error');
            return;
        }

        newOrder.buyerId = user._id;
        newOrder.keypadOrder = true;

        // Get product
        Product.aggregate([
            { $match: { 'keypadId': Number(req.body.product) } },
            { $lookup: { from: 'deliveries', localField: '_id', foreignField: 'productId', as: 'stock'} },
            { $project: {
              keypadId: "$keypadId",
              displayName: "$displayName",
              description: "$description",
              imagePath: "$imagePath",
              stock: { $filter: { // We filter only the stock object from array where ammount left is greater than 0
                  input: '$stock',
                  as: 'stock',
                  cond: { $gt: ['$$stock.amount_left', 0]}
              }}
            }}
        ],
            function(err, product) {
                if (err) {
                res.status(err.status || 500);
                res.render('error');
                return;
                }
                if (typeof product[0] === 'undefined' || typeof product[0].stock[0] === 'undefined') {
                    res.status(500);
                    res.render('error');
                    return;
                }
                newOrder.deliveryId = product[0].stock[0]._id;
                var newAmount = product[0].stock[0].amount_left-1;

                Delivery.findByIdAndUpdate(product[0].stock[0]._id, { amount_left: newAmount }, function (err, delivery) {
                    if (err) {
                        res.status(err.status || 500);
                        res.render('error');
                        return;
                    }

                    newOrder.save(function(err) {
                        if (err) {
                            var subject = `Nepodařilo se zapsat změny do databáze!`;
                            var body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o vytvoření záznamu nákupu skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`;
                            mailer.sendMail('system', subject, body);
                            return;
                        }
                        var subject = `Děkujeme za nákup!`;
                        var body = `<h1>Výborná volba!</h1><p>Tímto jste si udělali radost:</p><img width="135" height="240" style="width: auto; height: 10rem;" alt="Obrázek zakoupeného produktu" src="cid:image@prdelka.eu"/><p>Název: ${product[0].displayName}<br>Cena: ${product[0].stock[0].price}Kč<br>Kdy: ${moment().format('LLLL')}</p><p>Přijďte zas!</p>`;
                        mailer.sendMail(user.email, subject, body, product[0].imagePath);
                        res.status(200);
                        res.render('success');
                    });
                });
            }
        );
    });

});

module.exports = router;