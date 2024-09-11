import { Router } from 'express'
import { ensureAuthenticatedAPI } from '../../functions/ensureAuthenticatedAPI.js'
import Product from '../../models/product.js'
import Category from '../../models/category.js'
var router = Router()
let responseJson

// GET /api/productList - returns list of products, stock and price
router.get('/', ensureAuthenticatedAPI, function (req, res, _next) {
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
    .then((docs) => {
      Category.find({ disabled: { $in: [null, false] } })
        .sort([['name', 1]])
        .then((categories) => {
          res.set('Content-Type', 'application/json')
          if (!docs) {
            res.status(404)
            res.json('NOT_FOUND')
          } else {
            res.status(200)
            responseJson = docs
            // TODO: add categories
            res.json(responseJson)
          }
        })
        .catch((_err) => {
          res.status(400)
          res.set('Content-Type', 'application/problem+json')
          const responseJson = {
            type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#productList',
            title: 'Failed to retrieve list of categories.',
            status: 400
          }
          res.json(responseJson)
          return
        })
    })
    .catch((_err) => {
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      const responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#productList',
        title: 'Failed to retrieve list of products.',
        status: 400
      }
      res.json(responseJson)
      return
    })
})

export default router
