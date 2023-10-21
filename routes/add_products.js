import { Router } from 'express'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import Product from '../models/product.js'
import Delivery from '../models/delivery.js'
import csrf from 'csurf'
import logger from '../functions/logger.js'
var router = Router()
var csrfProtection = csrf()
router.use(csrfProtection)

/* GET add product page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.addproducts.get__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }
  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  Product.find()
    .sort([['displayName', 1]])
    .then((docs) => {
      logger.debug(
        `server.routes.addproducts.get__Successfully loaded ${docs[0].length} products.`,
        {
          metadata: {
            result: docs
          }
        }
      )
      docs.client_data = JSON.stringify({
        product_id: docs.map(
          (a) => a.id,
          (b) => b.imagePath
        ),
        product_image: docs.map((a) => a.imagePath)
      })

      res.render('shop/add_products', {
        title: 'Naskladnit | Lednice IT',
        products: docs,
        user: req.user,
        alert: alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error(`server.routes.addproducts.get__Failed to load products.`, {
        metadata: {
          error: err.message
        }
      })
      res.status(err.status || 500)
      res.render('error')
    })
})

/* POST add product form handle. */
router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.addproducts.post__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  Product.findById(req.body.product_id)
    .then((prod) => {
      logger.debug(
        `server.routes.addproducts.post__Successfully found product ${prod.displayName} in the database.`,
        {
          metadata: {
            result: prod
          }
        }
      )
      var newDelivery = new Delivery({
        supplierId: req.user.id,
        productId: req.body.product_id,
        amount_supplied: req.body.product_amount,
        amount_left: req.body.product_amount,
        price: req.body.product_price
      })

      newDelivery
        .save()
        .then((result) => {
          logger.info(
            `server.routes.addproducts.post__Successfully added product:[${prod.displayName}] amount:[${req.body.product_amount}] price:${req.body.product_price}.`,
            {
              metadata: {
                result: result
              }
            }
          )
          const alert = {
            type: 'success',
            message: `Produkt ${prod.displayName} přidán v počtu ${req.body.product_amount}ks za ${req.body.product_price}Kč.`,
            success: 1
          }
          req.session.alert = alert
          res.redirect('/add_products')
        })
        .catch((err) => {
          logger.error(
            `server.routes.addproducts.post__Failed to add product:[${prod.displayName}] amount:[${req.body.product_amount}] price:${req.body.product_price}.`,
            {
              metadata: {
                result: err.message
              }
            }
          )
          const alert = {
            type: 'danger',
            component: 'db',
            message: err.message,
            danger: 1
          }
          req.session.alert = alert
          res.redirect('/add_products')
        })
    })
    .catch((err) => {
      logger.error(
        `server.routes.addproducts.post__Failed to find product ${req.body.product_id} in the database.`,
        {
          metadata: {
            error: err.message
          }
        }
      )
      const alert = {
        type: 'danger',
        component: 'db',
        message: err.message,
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/add_products')
      return
    })
})

export default router
