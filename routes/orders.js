var express = require('express')
var router = express.Router()
var moment = require('moment')
moment.locale('cs')
var Order = require('../models/order')
var ensureAuthenticated =
  require('../functions/ensureAuthenticated').ensureAuthenticated
var checkKiosk = require('../functions/checkKiosk').checkKiosk

/* GET orders page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  if (req.baseUrl === '/admin_orders') {
    var filter
    if (!req.user.admin) {
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
    .catch((_err) => {})
})

module.exports = router
