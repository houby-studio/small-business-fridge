var express = require('express');
var router = express.Router();
var config = require('../../config/config');
var User = require('../../models/user');
var Order = require('../../models/order');
var Product = require('../../models/product');
var Delivery = require('../../models/delivery');

router.get('/', function(req, res, next) {
    console.log('yes');
});

/* GET about page. */
router.post('/', function(req, res, next) {

    if (req.body.secret != config.config.api_secret) {
        res.status(err.status || 500);
        res.render('error');
        return;
    }

    var newOrder = new Order();

    // Find user by keypadId
    User.findOne({ keypadId: req.body.customer }, function (err, user) {
        if (err) {
            res.status(err.status || 500);
            res.render('error');
            return;
        }

        newOrder.buyerId = user._id;

        // Get product
        Product.aggregate([
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

                console.log(product.stock[0]);
            }
        );
    });
    res.status(200);

    /*
    
  
    Delivery.findOne({ '_id': req.body.product_id}, function(err,obj) {
        if (err) {
          var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
          req.session.alert = alert;
          res.redirect('/shop');
          return;
        }
        obj.amount_left--;
        obj.save(function (err) {
            if (err) {
                var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
                req.session.alert = alert;
                res.redirect('/shop');
                var subject = `Nepodařilo se zapsat změny do databáze!`;
                var body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o snížení skladové zásoby skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`;
                mailer.sendMail('system', subject, body);
                return;
            }
            newOrder.save(function(err) {
                if (err) {
                    var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
                    req.session.alert = alert;
                    res.redirect('/shop');
                    var subject = `Nepodařilo se zapsat změny do databáze!`;
                    var body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o vytvoření záznamu nákupu skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`;
                    mailer.sendMail('system', subject, body);
                    return;
                }
                var alert = { type: 'success', message: `Zakoupili jste ${req.body.display_name} za ${req.body.product_price}Kč.`, success: 1};
                req.session.alert = alert;
                res.redirect('/shop');
                if (req.user.sendMailOnEshopPurchase) {
                  var subject = `Děkujeme za nákup!`;
                  var body = `<h1>Výborná volba!</h1><p>Tímto jste si udělali radost:</p><img width="135" height="240" style="width: auto; height: 10rem;" alt="Obrázek zakoupeného produktu" src="cid:image@prdelka.eu"/><p>Název: ${req.body.display_name}<br>Cena: ${req.body.product_price}Kč<br>Kdy: ${moment().format('LLLL')}</p><p>Přijďte zas!</p>`;
                  mailer.sendMail(req.user.email, subject, body, req.body.image_path);
                }
                return;
            });
        });
    });
    */
});

module.exports = router;