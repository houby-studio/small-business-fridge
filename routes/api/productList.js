import { Router } from 'express'
import { ensureAuthenticatedAPI } from '../../functions/ensureAuthenticatedAPI.js'
import Product from '../../models/product.js'
const router = Router()
let responseJson

// GET /api/productList - returns list of products, stock and price
router.get('/', ensureAuthenticatedAPI, function (req, res) {
  // Find products in database
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
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        pipeline: [{ $match: { disabled: { $in: [null, false] } } }],
        as: 'category'
      }
    },
    {
      $match: {
        'stock.amount_left': {
          $gt: 0
        }
      }
    },
    {
      $project: {
        keypadId: '$keypadId',
        displayName: '$displayName',
        description: '$description',
        imagePath: '$imagePath',
        category: '$category',
        stock: {
          $filter: {
            // We filter only the stock object from array where amount left is greater than 0
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
    .then((products) => {
      res.set('Content-Type', 'application/json')
      if (!products) {
        res.status(404)
        res.json('NOT_FOUND')
      } else {
        res.status(200)
        if (req.query.voicebot) {
          responseJson = products.map((product) => {
            return {
              keypadId: product.keypadId,
              displayName: product.displayName,
              description: product.description,
              category: product.category.some((a) => typeof a == 'object')
                ? product.category[0].name
                : '',
              stockSum: product.stockSum,
              price: product.stock[0].price
            }
          })
        } else {
          responseJson = products
        }
        res.json(responseJson)
      }
    })
    .catch((e) => {
      console.log(e)
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      const responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#productList',
        title: 'Failed to retrieve list of products.',
        status: 400
      }
      res.json(responseJson)
    })
})

export default router
