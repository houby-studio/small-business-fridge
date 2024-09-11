import { Router } from 'express'
import moment from 'moment'
import Order from '../models/order.js'
import Delivery from '../models/delivery.js'
import { sendMail } from '../functions/sendMail.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import csrf from 'csurf'
import logger from '../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)
moment.locale('cs')

/* GET orders page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  if (req.baseUrl === '/admin_orders') {
    var filter
    if (!req.user.admin) {
      logger.warn(
        'server.routes.orders.get__User tried to access admin page without permission.',
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.redirect('/')
      return
    }
    filter = {}
  } else {
    filter = {
      buyerId: req.user._id
    }
  }

  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  Order.aggregate([
    {
      $match: filter
    },
    {
      $sort: {
        _id: -1
      }
    },
    {
      $lookup: {
        from: 'deliveries',
        localField: 'deliveryId',
        foreignField: '_id',
        as: 'deliveryInfo'
      }
    },
    {
      $unwind: '$deliveryInfo'
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryInfo.supplierId',
        foreignField: '_id',
        as: 'supplierInfo'
      }
    },
    {
      $unwind: '$supplierInfo'
    },
    {
      $lookup: {
        from: 'users',
        localField: 'buyerId',
        foreignField: '_id',
        as: 'buyerInfo'
      }
    },
    {
      $unwind: '$buyerInfo'
    },
    {
      $lookup: {
        from: 'products',
        localField: 'deliveryInfo.productId',
        foreignField: '_id',
        as: 'productInfo'
      }
    },
    {
      $unwind: '$productInfo'
    },
    {
      $group: {
        _id: null,
        totalOrders: {
          $sum: 1
        },
        totalSpend: {
          $sum: '$deliveryInfo.price'
        },
        results: {
          $push: '$$ROOT'
        }
      }
    },
    {
      $project: {
        totalOrders: 1,
        totalSpend: 1,
        results: 1,
        totalUnpaid: {
          $let: {
            vars: {
              field: {
                $filter: {
                  input: '$results',
                  as: 'calc',
                  cond: {
                    $eq: ['$$calc.invoice', false]
                  }
                }
              }
            },
            in: {
              $sum: '$$field.deliveryInfo.price'
            }
          }
        }
      }
    }
  ])
    .then((docs) => {
      if (docs[0]) {
        logger.debug(
          `server.routes.orders.get__Successfully loaded ${docs[0].results.length} orders.`,
          {
            metadata: {
              result: docs
            }
          }
        )
        const fifteen_minutes_ago = moment(new Date() - 900000)
        docs[0].results.forEach(function (element) {
          // If older than 15 minutes, disable storno button
          if (req.baseUrl === '/admin_orders') {
            if (
              fifteen_minutes_ago > element.order_date ||
              element.invoice === true
            ) {
              element.cancel = false
            } else {
              element.cancel = true
            }
          }
          element.order_date_format = moment(element.order_date).format('LLLL')
          element.order_date = moment(element.order_date).format()
        })
      }

      res.render('shop/orders', {
        title: 'Objednávky | Lednice IT',
        orders: docs[0],
        admin: filter,
        user: req.user,
        alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error('server.routes.orders.get__Failed to load orders.', {
        metadata: {
          error: err.message
        }
      })
    })
})

/* POST admin_orders page - orders page has no POST method. */
router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      'server.routes.adminorders.post__User tried to cancel order on admin page without permission.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }
  if (req.body.name === 'storno') {
    // Allow to cancel order only if it's not older than 15 minutes and not invoiced
    Order.findOneAndDelete({
      _id: req.body.order,
      order_date: { $gte: new moment(new Date() - 900000) },
      invoice: false
    })
      .populate('buyerId', 'email')
      .populate({
        path: 'deliveryId',
        populate: {
          path: 'productId',
          select: ['displayName', 'imagePath']
        },
        select: ['productId', 'price']
      })
      .then((order) => {
        if (!order) {
          logger.warn(
            'server.routes.adminorders.post__Order not found or already invoiced or older than 15 minutes.',
            {
              metadata: {
                result: req.body.order
              }
            }
          )
          const alert = {
            type: 'danger',
            message:
              'Objednávku nelze stornovat. Buď neexistuje, byla fakturována nebo byla provedena před více než 15 minutami.',
            danger: 1
          }
          req.session.alert = alert
          res.redirect('/admin_orders')
          return
        }
        logger.debug(
          `server.routes.adminorders.post__Order [${order._id}] with product [${order.deliveryId.productId.displayName}] purchased by user [${order.buyerId.email}] has been deleted.`,
          {
            metadata: {
              object: order
            }
          }
        )
        Delivery.findByIdAndUpdate(
          {
            _id: order.deliveryId._id
          },
          {
            $inc: {
              amount_left: 1
            }
          }
        )
          .then((delivery) => {
            logger.debug(
              `server.routes.adminorders.post__Returned product's stock amount incremented in delivery [${delivery._id}] by one.`,
              {
                metadata: {
                  object: delivery
                }
              }
            )
            logger.info(
              `server.routes.adminorders.post__User [${req.user.displayName}] succesfully returned product [${order.deliveryId.productId.displayName}] for [${order.deliveryId.price}].`,
              {
                metadata: {
                  order: delivery
                }
              }
            )

            const alert = {
              type: 'success',
              message: `Stornovali jste ${order.deliveryId.productId.displayName} za ${order.deliveryId.price} Kč a e-mail byl zaslán zákazníkovi na adresu ${order.buyerId.email}.`,
              success: 1
            }
            req.session.alert = alert
            res.redirect('/admin_orders')
            const subject = `Stornování objednávky - ${order.deliveryId.productId.displayName}`
            const mailPreview = `Administrátor ${req.user.displayName} stornoval ${order.deliveryId.productId.displayName} za ${order.deliveryId.price} Kč.`
            sendMail(
              order.buyerId.email,
              'productReturned',
              {
                subject,
                mailPreview,
                orderId: order._id,
                productId: order.deliveryId.productId._id,
                productName: order.deliveryId.productId.displayName,
                productPrice: order.deliveryId.price,
                purchaseDate: moment(order.order_date).format('LLLL')
              },
              order.deliveryId.productId.imagePath
            )
          })
          .catch((err) => {
            logger.error(
              'server.routes.adminorders.post__Failed to increment stock in the database, but order has been already deleted!',
              {
                metadata: {
                  error: err.message,
                  order
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
            res.redirect('/admin_orders')
            const subject = '[SYSTEM ERROR] Chyba při zápisu do databáze!'
            const message = `Potenciálně se nepodařilo zapsat navýšení stavu dodávky do databáze, ale již došlo k odstranění objednávky. Dodávka ID [${order.deliveryId._id}]. Administrátor [${req.user.displayName}] se pokusil zákazníkovi ID [${order.buyerId._id}], e-mail [${order.buyerId.email}] stornovat produkt ID [${order.deliveryId.productId._id}], zobrazované jméno [${order.deliveryId.productId.displayName}] za [${order.deliveryId.price}] Kč. Zkontrolujte konzistenci databáze.`
            sendMail('system@system', 'systemMessage', {
              subject,
              message,
              messageTime: moment().toISOString(),
              errorMessage: err.message
            })
          })
      })
      .catch((err) => {
        logger.error(
          'server.routes.adminorders.post__Failed delete order from database.',
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
        res.redirect('/admin_orders')
      })
  } else {
    res.status(400).send()
  }
})

export default router
