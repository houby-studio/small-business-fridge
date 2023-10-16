const express = require('express')
const router = express.Router()
const moment = require('moment')
const Product = require('../models/product')
const Order = require('../models/order')
const Delivery = require('../models/delivery')
const mailer = require('../functions/sendMail')
const ensureAuthenticated =
  require('../functions/ensureAuthenticated').ensureAuthenticated
const checkKiosk = require('../functions/checkKiosk').checkKiosk
const csrf = require('csurf')
const csrfProtection = csrf()
router.use(csrfProtection)
moment.locale('cs')

function renderPage(req, res, alert) {
  let filter
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
  Product.aggregate([
    {
      $lookup: {
        from: 'deliveries',
        localField: '_id',
        foreignField: 'productId',
        as: 'stock'
      }
    },
    {
      // Depending on user preferences, get either all products or only ones in stock
      $match: filter
    },
    {
      $project: {
        keypadId: '$keypadId',
        displayName: '$displayName',
        description: '$description',
        imagePath: '$imagePath',
        stock: {
          $filter: {
            // We filter only the stock object from array where ammount left is greater than 0
            input: '$stock',
            as: 'stock',
            cond: {
              $gt: ['$$stock.amount_left', 0]
            }
          }
        },
        stockSum: {
          $sum: '$stock.amount_left'
        }
      }
    },
    {
      $sort: {
        displayName: 1
      }
    }
  ])
    .then((docs) => {
      const productChunks = []
      const chunkSize = 4
      for (let i = 0; i < docs.length; i += chunkSize) {
        productChunks.push(docs.slice(i, i + chunkSize))
      }

      res.render('shop/shop', {
        title: 'E-shop | Lednice IT',
        products: productChunks,
        user: req.user,
        alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      res.status(err.status || 500)
      res.render('error')
    })
}

/* GET shop page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  let alert
  if (req.session.alert) {
    alert = req.session.alert
    delete req.session.alert
  }
  renderPage(req, res, alert)
})

/* POST shop page. */
router.post('/', ensureAuthenticated, checkKiosk, function (req, res) {
  if (req.user.id !== req.body.user_id) {
    const alert = {
      type: 'danger',
      component: 'web',
      message:
        'Při zpracování objednávky došlo k chybě. Zkuste to prosím znovu.',
      danger: 1
    }
    req.session.alert = alert
    res.redirect('/shop')
    return
  }

  const newOrder = new Order({
    buyerId: req.user.id,
    deliveryId: req.body.product_id
  })

  Delivery.findOne({
    _id: req.body.product_id
  })
    .then((obj) => {
      obj.amount_left--
      obj
        .save()
        .then(() => {
          newOrder
            .save()
            .then(() => {
              const alert = {
                type: 'success',
                message: `Zakoupili jste ${req.body.display_name} za ${req.body.product_price}Kč.`,
                success: 1
              }
              req.session.alert = alert
              res.redirect('/shop')
              if (req.user.sendMailOnEshopPurchase) {
                const subject = 'Děkujeme za nákup!'
                const body = `<h1>Výborná volba!</h1><p>Tímto jste si udělali radost:</p><img width="135" height="240" style="width: auto; height: 10rem;" alt="Obrázek zakoupeného produktu" src="cid:image@prdelka.eu"/><p>Název: ${
                  req.body.display_name
                }<br>Cena: ${
                  req.body.product_price
                }Kč<br>Kdy: ${moment().format('LLLL')}</p><p>Přijďte zas!</p>`
                mailer.sendMail(
                  req.user.email,
                  subject,
                  body,
                  req.body.image_path
                )
              }
            })
            .catch((err) => {
              const alert = {
                type: 'danger',
                component: 'db',
                message: err.message,
                danger: 1
              }
              req.session.alert = alert
              res.redirect('/shop')
              const subject = 'Nepodařilo se zapsat změny do databáze!'
              const body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o vytvoření záznamu nákupu skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`
              mailer.sendMail('system', subject, body)
              return
            })
        })
        .catch((err) => {
          const alert = {
            type: 'danger',
            component: 'db',
            message: err.message,
            danger: 1
          }
          req.session.alert = alert
          res.redirect('/shop')
          const subject = 'Nepodařilo se zapsat změny do databáze!'
          const body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o snížení skladové zásoby skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`
          mailer.sendMail('system', subject, body)
          return
        })
    })
    .catch((err) => {
      const alert = {
        type: 'danger',
        component: 'db',
        message: err.message,
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/shop')
      return
    })
})

module.exports = router
