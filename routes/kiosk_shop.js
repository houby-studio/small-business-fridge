import { Router } from 'express'
import moment from 'moment'
import Product from '../models/product.js'
import Order from '../models/order.js'
import Delivery from '../models/delivery.js'
import User from '../models/user.js'
import { sendMail } from '../functions/sendMail.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import csrf from 'csurf'
import logger from '../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)
moment.locale('cs')

function renderPage(req, res, alert, customer) {
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
      $match: filter
    }, // Depending on user preferences, get either all products or only ones in stock
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
      res.render('shop/kiosk_shop', {
        title: 'Kiosek | Lednice IT',
        products: productChunks,
        user: req.user,
        customer,
        alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error(
        'server.routes.kioskshop.get__Failed to query products from database.',
        {
          metadata: {
            error: err.message
          }
        }
      )
      res.status(err.status || 500)
      res.render('error')
    })
}

/* GET kiosk shop page. */
router.get('/', ensureAuthenticated, function (req, res) {
  // If user is not kiosk, return to home page
  if (!req.user.kiosk) {
    logger.warn(
      'server.routes.kioskshop.get__User does not have kiosk role. Redirecting back to home page.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }
  // If customer id is not defined, alert and route back to keypad
  let alert
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
  })
    .then((customer) => {
      if (!customer) {
        logger.debug(
          `server.routes.kioskshop.get__Failed to find user by keypadId ${req.query.customer_id}.`,
          {
            metadata: {
              object: req.query.customer_id
            }
          }
        )
        req.session.alert = {
          type: 'danger',
          component: 'web',
          message: `Nepodařilo se dohledat zákazníka s ID ${req.query.customer_id}.`,
          danger: 1
        }
        res.redirect('/kiosk_keypad')
        return
      }
      logger.debug(
        `server.routes.kioskshop.get__Found user:[${customer.email}] by keypadId:[${req.query.customer_id}].`,
        {
          metadata: {
            object: customer
          }
        }
      )
      if (req.session.alert) {
        alert = req.session.alert
        delete req.session.alert
      }
      renderPage(req, res, alert, customer)
    })
    .catch((err) => {
      logger.error(
        `server.routes.kioskshop.get__Failed to find user by keypadId:[${req.query.customer_id}].`,
        {
          metadata: {
            error: err.message
          }
        }
      )
      req.session.alert = {
        type: 'danger',
        component: 'web',
        message:
          'Došlo k chybě při komunikaci s databází. Zkuste to prosím znovu.',
        danger: 1
      }
      res.redirect('/kiosk_keypad')
      return
    })
})

router.post('/', ensureAuthenticated, function (req, res) {
  if (req.user.id !== req.body.user_id) {
    logger.warn(
      'server.routes.kioskshop.post__User identity does not match with request body. No product has been purchased.',
      {
        metadata: {
          userIdentity: req.user.id,
          bodyIdentity: req.body.user_id
        }
      }
    )
    req.session.alert = {
      type: 'danger',
      component: 'web',
      message:
        'Při zpracování objednávky došlo k chybě. Zkuste to prosím znovu.',
      danger: 1
    }
    res.redirect('/kiosk_keypad')
    return
  }

  const newOrder = new Order({
    deliveryId: req.body.product_id
  })

  // Find user by keypadId
  User.findOne({
    keypadId: req.body.customer_id
  })
    .then((user) => {
      if (!user) {
        logger.error(
          `server.routes.kioskshop.post__Failed to find user by keypadId ${req.body.customer_id}.`,
          {
            metadata: {
              error: req.body.customer_id
            }
          }
        )
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
      })
        .then((object) => {
          object.amount_left--
          object
            .save()
            .then(() => {
              logger.debug(
                `server.routes.kioskshop.post__Purchased product stock amount decremented from delivery [${object._id}].`,
                {
                  metadata: {
                    object: object
                  }
                }
              )
              newOrder
                .save()
                .then(() => {
                  req.session.alert = {
                    type: 'success',
                    message: `Zákazník ${user.displayName} zakoupil ${req.body.display_name} za ${req.body.product_price}Kč.`,
                    success: 1
                  }
                  const subject = 'Děkujeme za nákup!'
                  const body = `<h1>Výborná volba!</h1><p>Tímto jste si udělali radost:</p><img width="135" height="240" style="width: auto; height: 10rem;" alt="Obrázek zakoupeného produktu" src="cid:image@prdelka.eu"/><p>Název: ${
                    req.body.display_name
                  }<br>Cena: ${
                    req.body.product_price
                  }Kč<br>Kdy: ${moment().format('LLLL')}</p><p>Přijďte zas!</p>`
                  sendMail(user.email, subject, body, req.body.image_path)
                  res.redirect('/kiosk_keypad')
                })
                .catch((err) => {
                  logger.error(
                    'server.routes.kioskshop.post__Failed to create order in the database, but stock amount has been already decremented!',
                    {
                      metadata: {
                        error: err.message,
                        delivery: object
                      }
                    }
                  )
                  req.session.alert = {
                    type: 'danger',
                    component: 'db',
                    message: err.message,
                    danger: 1
                  }
                  res.redirect('/kiosk_keypad')
                  const subject = 'Nepodařilo se zapsat změny do databáze!'
                  const body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o vytvoření záznamu nákupu skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`
                  sendMail('system@system', subject, body)
                  return
                })
            })
            .catch((err) => {
              logger.error(
                'server.routes.kioskshop.post__Failed to decrement stock amount from the delivery.',
                {
                  metadata: {
                    error: err.message
                  }
                }
              )
              req.session.alert = {
                type: 'danger',
                component: 'db',
                message: err.message,
                danger: 1
              }
              res.redirect('/kiosk_keypad')
              const subject = 'Nepodařilo se zapsat změny do databáze!'
              const body = `<h1>Chyba při zapisování do databáze při nákupu!</h1><p>Pokus o snížení skladové zásoby skončil chybou. Zkontrolujte konzistenci databáze!</p><p>Chyba: ${err.message}</p>`
              sendMail('system@system', subject, body)
              return
            })
        })
        .catch((err) => {
          logger.error(
            `server.routes.kioskshop.post__Failed to find delivery for product ${req.body.product_id}.`,
            {
              metadata: {
                error: err.message
              }
            }
          )
          req.session.alert = {
            type: 'danger',
            component: 'db',
            message: err.message,
            danger: 1
          }
          res.redirect('/kiosk_keypad')
          return
        })
    })
    .catch((err) => {
      logger.error(
        'server.routes.kioskshop.post__Failed to communicate with database.',
        {
          metadata: {
            error: err.message
          }
        }
      )
      req.session.alert = {
        type: 'danger',
        component: 'web',
        message:
          'Došlo k chybě při komunikaci s databází. Zkuste to prosím znovu.',
        danger: 1
      }
      res.redirect('/kiosk_keypad')
      return
    })
})

export default router
