var express = require('express')
var router = express.Router()
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated
var Product = require('../models/product')
var Delivery = require('../models/delivery')
var csrf = require('csurf')
var csrfProtection = csrf()
router.use(csrfProtection)

/* GET add product page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    res.redirect('/')
    return
  }
  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  Product.find(function (err, docs) {
    if (err) {
      res.status(err.status || 500)
      res.render('error')
    }

    docs.client_data = JSON.stringify({
      product_id: docs.map(a => a.id, b => b.imagePath),
      product_image: docs.map(a => a.imagePath)
    })

    res.render('shop/add_products', {
      title: 'Naskladnit | Lednice IT',
      products: docs,
      user: req.user,
      alert: alert,
      csrfToken: req.csrfToken()
    })
  })
})

/* POST add product form handle. */
router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    res.redirect('/')
    return
  }

  Product.findById(req.body.product_id, function (err, prod) {
    if (err) {
      var alert = {
        type: 'danger',
        component: 'db',
        message: err.message,
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/add_products')
      return
    }
    var newDelivery = new Delivery({
      supplierId: req.user.id,
      productId: req.body.product_id,
      amount_supplied: req.body.product_amount,
      amount_left: req.body.product_amount,
      price: req.body.product_price
    })

    newDelivery.save(function (err) {
      var alert
      if (err) {
        alert = {
          type: 'danger',
          component: 'db',
          message: err.message,
          danger: 1
        }
        req.session.alert = alert
        res.redirect('/add_products')
      }
      alert = {
        type: 'success',
        message: `${prod.displayName} přidán v počtu ${req.body.product_amount}ks za ${req.body.product_price}Kč.`,
        success: 1
      }
      req.session.alert = alert
      res.redirect('/add_products')
    })
  })
})

module.exports = router
