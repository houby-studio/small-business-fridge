var express = require('express');
var router = express.Router();
var moment = require('moment');
var Product = require('../models/product');
var Order = require('../models/order');
var Delivery = require('../models/delivery');
var mailer = require('../functions/sendMail');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;
var csrf = require('csurf');
var csrfProtection = csrf();
router.use(csrfProtection);
moment.locale('cs');

function renderPage(req, res, alert) {

  if (req.user.showAllProducts) {
    var filter = {};
  } else {
    var filter = { "stock.amount_left": { "$gt" : 0 }};
  }

  // This crazy query which can be roughly translated for SQL people to "SELECT * FROM Product WHERE Stock.ammount_left > 0"
  Product.aggregate([
    { $lookup: { from: 'deliveries', localField: '_id', foreignField: 'productId', as: 'stock'} },
    { $match: filter}, // Depending on user preferences, get either all products or only ones in stock
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
  function(err, docs) {
    if (err) {
      res.status(err.status || 500);
      res.render('error');
    }
    var productChunks = [];
    var chunkSize = 4;
    for (var i = 0; i < docs.length; i += chunkSize) {
      productChunks.push(docs.slice(i, i + chunkSize));
    }

    res.render('shop/shop', { title: 'E-shop | Lednice IT', products: productChunks, user: req.user, alert: alert, csrfToken: req.csrfToken() });
  });
}

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

  if (req.session.alert) {
    var alert = req.session.alert;
    delete req.session.alert;
  }
  renderPage(req, res, alert);
  
});

router.post('/', ensureAuthenticated, function (req, res) {

  if (req.user.id != req.body.user_id) {
    var alert = { type: 'danger', component: 'web', message: 'Při zpracování objednávky došlo k chybě. Zkuste to prosím znovu.', danger: 1};
    req.session.alert = alert;
    res.redirect('/shop');
    return;
  }

  var newOrder = new Order({
      'buyerId': req.user.id,
      'deliveryId': req.body.product_id
  });

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
});

module.exports = router;
