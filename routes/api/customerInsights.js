import { Router } from 'express'
import { ensureAuthenticatedAPI } from '../../functions/ensureAuthenticatedAPI.js'
import User from '../../models/user.js'
import Order from '../../models/order.js'
const router = Router()
let responseJson

function getLastOrders(userId) {
  return Order.aggregate([
    {
      $match: { buyerId: userId }
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
      $limit: 5
    },
    {
      $project: {
        _id: 0,
        product_id: '$productInfo.keypadId',
        product_name: '$productInfo.displayName',
        order_date: 1
      }
    }
  ])
}

function getMonthlyProductCount(userId) {
  return Order.aggregate([
    {
      $match: {
        buyerId: userId,
        order_date: {
          $gte: new Date(new Date().setMonth(new Date().getMonth() - 1))
        }
      }
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
        _id: '$productInfo.displayName',
        count: {
          $sum: 1
        }
      }
    },
    {
      $project: {
        _id: 0,
        product_name: '$_id',
        purchase_count: '$count'
      }
    }
  ])
}

// GET /api/customerInsights - accepts customer's phone number and returns customer insights to be used by voice bot
router.get('/', ensureAuthenticatedAPI, function (req, res) {
  // Check if request contains 'customer' parameter
  if (!req.query.customer) {
    res.status(400)
    res.set('Content-Type', 'application/problem+json')
    responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerInsights',
      title: "Your request does not contain parameter 'customer'.",
      status: 400,
      'detail:':
        "This function requires parameter 'customer'. More details can be found in documentation https://git.io/JeodS",
      'invalid-params': [
        {
          name: 'customer',
          reason: 'must be specified'
        }
      ]
    }
    res.json(responseJson)
    return
  }

  const formattedPhone = req.query.customer
    .toString()
    .replace(/ /g, '')
    .replace('+', '00')

  console.log('Finding user with phone: ', formattedPhone)

  // Find user in database
  User.findOne({
    phone: formattedPhone
  })
    .then((user) => {
      // If database doesn't contain user with supplied phone, database returns empty object, which doesn't contain any properties.
      res.set('Content-Type', 'application/json')
      if (!user) {
        res.status(404)
        res.json('NOT_FOUND')
      } else {
        res.status(200)
        getLastOrders(user._id).then((orders) => {
          getMonthlyProductCount(user._id).then((monthlyProductCount) => {
            const orderId = user.card ? user.card : user.keypadId
            responseJson = {
              customer_id: orderId,
              customer_name: user.displayName,
              last_five_products_bought: orders,
              product_purchase_count_last_month: monthlyProductCount
            }
            res.json(responseJson)
          })
        })
      }
    })
    .catch(() => {
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      const responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerInsights',
        title: "Your parameter 'customer' is wrong type.",
        status: 400,
        'detail:':
          "Parameter 'customer' must be a 'String'. More details can be found in documentation https://git.io/JeodS",
        'invalid-params': [
          {
            name: 'customer',
            reason:
              'must be a string containing phone number with country code. For example +420 123 456 789.'
          }
        ]
      }
      res.json(responseJson)
    })
})

export default router
