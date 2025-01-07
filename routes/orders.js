import { Router } from 'express'
import moment from 'moment'
import Order from '../models/order.js'
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
      $group: {
        _id: null,
        totalOrders: {
          $sum: 1
        },
        totalSpend: {
          $sum: '$deliveryInfo.price'
        },
        totalUnpaid: {
          $sum: {
            $cond: [{ $eq: ['$invoice', false] }, '$deliveryInfo.price', 0]
          }
        }
      }
    }
  ])
    .then((sums) => {
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
        }
      ])
        .then((docs) => {
          if (docs.length > 0) {
            logger.debug(
              `server.routes.orders.get__Successfully loaded ${docs.length} orders.`,
              {
                metadata: {
                  result: docs
                }
              }
            )
            docs.forEach(function (element) {
              element.order_date_format = moment(element.order_date).format(
                'LLLL'
              )
              element.order_date = moment(element.order_date).format()
            })
          }

          res.render('shop/orders', {
            title:
              req.baseUrl === '/admin_orders'
                ? 'Všechny objednávky | Lednice IT'
                : 'Objednávky | Lednice IT',
            orders: {
              totalOrders: sums[0]?.totalOrders || 0,
              totalSpend: sums[0]?.totalSpend || 0,
              totalUnpaid: sums[0]?.totalUnpaid || 0,
              results: docs
            },
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
    .catch((err) => {
      logger.error('server.routes.orders.get__Failed to load order sums.', {
        metadata: {
          error: err.message
        }
      })
    })
})

export default router
