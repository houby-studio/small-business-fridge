import { Router } from 'express'
import { ensureAuthenticatedDashboardAPI } from '../../functions/ensureAuthenticatedDashboardAPI.js'
import Order from '../../models/order.js'
const router = Router()

// GET /api/orders - returns list of products, stock and price
router.get('/', ensureAuthenticatedDashboardAPI, function (req, res) {
  // Find products in database
  Order.aggregate([
    {
      $limit: parseInt(req.query.limit) || 25
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
      $project: {
        _id: 0,
        order_date: 1,
        'buyerInfo._id': 1,
        'buyerInfo.displayName': 1,
        'buyerInfo.email': 1,
        'productInfo.displayName': 1,
        'deliveryInfo.price': 1
      }
    }
  ])
    .then((orders) => {
      res.set('Content-Type', 'application/json')
      if (!orders) {
        res.status(404)
        res.json('NOT_FOUND')
      } else {
        const responseJson = orders.map((order) => {
          return {
            order_date: order.order_date,
            buyer_id: order.buyerInfo._id,
            buyer_display_name: req.query.anonymize
              ? order.buyerInfo._id
              : order.buyerInfo.displayName,
            buyer_email: req.query.anonymize
              ? `${order.buyerInfo._id}@example.com`
              : order.buyerInfo.email,
            product_name: order.productInfo.displayName,
            product_price: order.deliveryInfo.price
          }
        })
        res.status(200)
        res.json(responseJson)
      }
    })
    .catch((e) => {
      console.log(e)
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      const responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#orders',
        title: 'Failed to retrieve list of products.',
        status: 400
      }
      res.json(responseJson)
    })
})

export default router
