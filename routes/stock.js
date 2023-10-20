import { Router } from 'express'
import Delivery from '../models/delivery.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import logger from '../functions/logger.js'
var router = Router()

/* GET about page. */
router.get('/', ensureAuthenticated, function (req, res, next) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.stock.get__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  Delivery.aggregate([
    {
      $match: {
        supplierId: req.user._id
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'deliveryId',
        as: 'bought'
      }
    },
    // { $unwind: { path: '$bought', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$productId',
        product: {
          $first: '$product'
        },
        amount_left: {
          $sum: '$amount_left'
        },
        // amount_supplied: { $sum: '$amount_supplied' },
        bought: {
          $push: {
            $size: {
              $filter: {
                input: '$bought',
                as: 'orders',
                cond: {
                  $gte: [
                    '$$orders.order_date',
                    new Date(new Date() - 14 * 60 * 60 * 24 * 1000)
                  ]
                } // X = 14 days right now
              }
            }
          }
        }
      }
    },
    {
      $project: {
        amount_left: 1,
        display_name: '$product.displayName',
        last_Xdays: {
          $sum: '$bought'
        }
      }
    }
  ])
    .then((docs) => {
      res.render('shop/stock', {
        title: 'Stav skladu | Lednice IT',
        user: req.user,
        stock: docs
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
      res.redirect('/')
      return
    })
})

export default router
