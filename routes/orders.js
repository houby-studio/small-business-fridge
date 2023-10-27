import { Router } from 'express'
import moment from 'moment'
import Order from '../models/order.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import logger from '../functions/logger.js'
var router = Router()
moment.locale('cs')

/* GET orders page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  if (req.baseUrl === '/admin_orders') {
    var filter
    if (!req.user.admin) {
      logger.warn(
        `server.routes.orders.get__User tried to access admin page without permission.`,
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
      if (req.query.a) {
        var alert = {
          type: req.query.a,
          component: req.query.c,
          message: req.query.m,
          success: req.query.s,
          danger: req.query.d
        }
      }
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
        title: 'Objednávky | Lednice IT',
        orders: docs[0],
        admin: filter,
        user: req.user,
        alert: alert
      })
    })
    .catch((err) => {
      logger.error(`server.routes.orders.get__Failed to load orders.`, {
        metadata: {
          error: err.message
        }
      })
    })
})

export default router
