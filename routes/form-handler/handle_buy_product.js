var querystring = require('querystring');
var moment = require('moment');
var express = require('express');
var router = express.Router();
var mailer = require('../../functions/sendMail');
var ensureAuthenticated = require('../../functions/ensureAuthenticated').ensureAuthenticated;
var Order = require('../../models/order');
var Delivery = require('../../models/delivery');

moment.locale('cs');

router.post('/', ensureAuthenticated, function (req, res) {

    var newOrder = new Order({
        'buyerId': req.user.id,
        'deliveryId': req.body.product_id
    });

    Delivery.findOne({ '_id': req.body.product_id}, function(err,obj) {
        if (err) {
            console.log(err);
            var query = querystring.stringify({
                "a": 'danger', "d": 1, "c": 'db', "m": err.message
            });
            res.redirect('/shop?' + query);
            return;
        }
        obj.amount_left--;
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
                var body = `<h1>Výborná volba!</h1><p>Tímto jste si udělali radost:</p><img width="135" height="240" style="width: auto; height: 10rem;" alt="Obrázek zakoupeného produktu" src="cid:image@prdelka.eu"/><p>Název: ${req.body.display_name}<br>Cena: ${req.body.product_price}Kč<br>Kdy: ${moment().format('LLLL')}</p><p>Přijďte zas!</p>`;
                mailer.sendMail(req.user.email, subject, body, obj.imagePath);
                return;
            });
        });
    });
});

module.exports = router;
