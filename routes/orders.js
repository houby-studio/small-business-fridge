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
        docs[0].results.forEach(function (element) {
          element.order_date_format = moment(element.order_date).format('LLLL')
          element.order_date = moment(element.order_date).format()
        })
      }

      res.render('shop/orders', {
        title:
          req.baseUrl === '/admin_orders'
            ? 'Všechny objednávky | Lednice IT'
            : 'Objednávky | Lednice IT',
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

export default router
