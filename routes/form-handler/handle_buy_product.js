var querystring = require('querystring');
var moment = require('moment');
var express = require('express');
var router = express.Router();
var mailer = require('../../functions/sendMail');
var ensureAuthenticated = require('../../functions/ensureAuthenticated').ensureAuthenticated;
var Order = require('../../models/order');
var Product = require('../../models/product');

moment.locale('cs');

router.post('/', ensureAuthenticated, function (req, res) {

    var newOrder = new Order({
        'buyerId': req.user.id,
        'stockId': req.body.product_id
    });

    Product.findOne({"stock._id": req.body.product_id}, function(err,obj) {
        if (err) {
            console.log(err);
            var query = querystring.stringify({
                "a": 'danger', "d": 1, "c": 'db', "m": err.message
            });
            res.redirect('/shop?' + query);
            return;
        }
        obj.stock.id(req.body.product_id).amount_left--;
        obj.save(function (err) {
            if (err) {
                console.log(err);
                var query = querystring.stringify({
                    "a": 'danger', "d": 1, "c": 'db', "m": err.message
                });
                res.redirect('/shop?' + query);
                var subject = `Nepodařilo se zapsat změny do databáze!`;
                var body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o snížení skladové zásoby skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`;
                mailer.sendMail('system', subject, body);
                return;
            }
            newOrder.save(function(err) {
                if (err) {
                    console.log(err);
                    var query = querystring.stringify({
                        "a": 'danger', "d": 1, "c": 'db', "m": err.message
                    });
                    res.redirect('/shop?' + query);
                    var subject = `Nepodařilo se zapsat změny do databáze!`;
                    var body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o vytvoření záznamu nákupu skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`;
                    mailer.sendMail('system', subject, body);
                    return;
                }
                var query = querystring.stringify({
                    "a": 'success', "s": 1, "m": `Zakoupili jste ${req.body.display_name} za ${req.body.product_price}Kč.`
                });
                res.redirect('/shop?' + query);
                var subject = `Děkujeme za nákup!`;
                var body = `<h1>Výborná volba!</h1><p>Čím jste si udělali radost</p><img src="cid:image@prdelka.eu"/>'<p>Název: ${req.body.display_name}<br>Cena: ${req.body.product_price}Kč<br>Kdy: ${moment().format('LLLL')}</p>`;
                mailer.sendMail(req.user.email, subject, body, obj.imagePath);
                return;
            });
        });
    });
});

module.exports = router;
