var express = require('express')
var router = express.Router()
var moment = require('moment')
var Product = require('../models/product')
var Order = require('../models/order')
var Delivery = require('../models/delivery')
var User = require('../models/user')
var mailer = require('../functions/sendMail')
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated
var csrf = require('csurf')
var csrfProtection = csrf()
router.use(csrfProtection)
moment.locale('cs')

function renderPage (req, res, alert, customer) {
  var filter
  if (req.user.showAllProducts) {
    filter = {}
  } else {
    filter = {
      'stock.amount_left': {
        $gt: 0
      }
    }
  }

  // This crazy query which can be roughly translated for SQL people to "SELECT * FROM Product WHERE Stock.ammount_left > 0"
  Product.aggregate([{
    $lookup: {
      from: 'deliveries',
      localField: '_id',
      foreignField: 'productId',
      as: 'stock'
    }
  },
  {
    $match: filter
  }, // Depending on user preferences, get either all products or only ones in stock
  {
    $project: {
      keypadId: '$keypadId',
      displayName: '$displayName',
      description: '$description',
      imagePath: '$imagePath',
      stock: {
        $filter: { // We filter only the stock object from array where ammount left is greater than 0
          input: '$stock',
          as: 'stock',
          cond: {
            $gt: ['$$stock.amount_left', 0]
          }
        }
      }
    }
  }
  ],
  function (err, docs) {
    if (err) {
      res.status(err.status || 500)
      res.render('error')
    }
    var productChunks = []
    var chunkSize = 4
    for (var i = 0; i < docs.length; i += chunkSize) {
      productChunks.push(docs.slice(i, i + chunkSize))
    }
    res.render('shop/kiosk_shop', {
      title: 'Kiosek | Lednice IT',
      products: productChunks,
      user: req.user,
      customer: customer,
      alert: alert,
      csrfToken: req.csrfToken()
    })
  })
}

/* GET kiosk shop page. */
router.get('/', ensureAuthenticated, function (req, res) {
  // If user is not kiosk, return to home page
  if (!req.user.kiosk) {
    res.redirect('/')
    return
  }
  // If customer id is not defined, alert and route back to keypad
  var alert
  if (!req.query.customer_id) {
    req.session.alert = {
      type: 'danger',
      component: 'web',
      message: 'Je nutné zadat platné číslo zákazníka.',
      danger: 1
    }
    res.redirect('/kiosk_keypad')
    return
  } else if (req.query.customer_id === '666') {
    // Log off kiosk function
    res.redirect('/logout')
    return
  }
  // Find user by keypadId
  User.findOne({
    keypadId: req.query.customer_id
  }, function (err, customer) {
    if (err) {
      req.session.alert = {
        type: 'danger',
        component: 'web',
        message: 'Došlo k chybě při komunikaci s databází. Zkuste to prosím znovu.',
        danger: 1
      }
      res.redirect('/kiosk_keypad')
      return
    }
    if (!customer) {
      req.session.alert = {
        type: 'danger',
        component: 'web',
        message: `Nepodařilo se dohledat zákazníka s ID ${req.query.customer_id}.`,
        danger: 1
      }
      res.redirect('/kiosk_keypad')
      return
    }
    if (req.session.alert) {
      alert = req.session.alert
      delete req.session.alert
    }
    renderPage(req, res, alert, customer)
  })
})

router.post('/', ensureAuthenticated, function (req, res) {
  if (req.user.id !== req.body.user_id) {
    req.session.alert = {
      type: 'danger',
      component: 'web',
      message: 'Při zpracování objednávky došlo k chybě. Zkuste to prosím znovu.',
      danger: 1
    }
    res.redirect('/kiosk_keypad')
    return
  }

  var newOrder = new Order({
    deliveryId: req.body.product_id
  })

  // Find user by keypadId
  User.findOne({
    keypadId: req.body.customer_id
  }, function (err, user) {
    if (err) {
      req.session.alert = {
        type: 'danger',
        component: 'web',
        message: 'Došlo k chybě při komunikaci s databází. Zkuste to prosím znovu.',
        danger: 1
      }
      res.redirect('/kiosk_keypad')
      return
    }
    if (!user) {
      req.session.alert = {
        type: 'danger',
        component: 'web',
        message: `Nepodařilo se dohledat zákazníka s ID ${req.body.customer_id}.`,
        danger: 1
      }
      res.redirect('/kiosk_keypad')
      return
    }

    newOrder.buyerId = user._id
    newOrder.keypadOrder = true

    Delivery.findOne({
      _id: req.body.product_id
    }, function (err, obj) {
      if (err) {
        req.session.alert = {
          type: 'danger',
          component: 'db',
          message: err.message,
          danger: 1
        }
        res.redirect('/kiosk_keypad')
        return
      }
      obj.amount_left--
      obj.save(function (err) {
        if (err) {
          req.session.alert = {
            type: 'danger',
            component: 'db',
            message: err.message,
            danger: 1
          }
          res.redirect('/kiosk_keypad')
          var subject = 'Nepodařilo se zapsat změny do databáze!'
          var body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o snížení skladové zásoby skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`
          mailer.sendMail('system', subject, body)
          return
        }
        newOrder.save(function (err) {
          var subject, body
          if (err) {
            req.session.alert = {
              type: 'danger',
              component: 'db',
              message: err.message,
              danger: 1
            }
            res.redirect('/kiosk_keypad')
            subject = 'Nepodařilo se zapsat změny do databáze!'
            body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o vytvoření záznamu nákupu skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`
            mailer.sendMail('system', subject, body)
            return
          }
          req.session.alert = {
            type: 'success',
            message: `Zákazník ${user.displayName} zakoupil ${req.body.display_name} za ${req.body.product_price}Kč.`,
            success: 1
          }
          subject = 'Děkujeme za nákup!'
          body = `<h1>Výborná volba!</h1><p>Tímto jste si udělali radost:</p><img width="135" height="240" style="width: auto; height: 10rem;" alt="Obrázek zakoupeného produktu" src="cid:image@prdelka.eu"/><p>Název: ${product[0].displayName}<br>Cena: ${product[0].stock[0].price}Kč<br>Kdy: ${moment().format('LLLL')}</p><p>Přijďte zas!</p>`
          mailer.sendMail(user.email, subject, body, req.body.image_path)
          res.redirect('/kiosk_keypad')
        })
      })
    })
  })
})

module.exports = router
