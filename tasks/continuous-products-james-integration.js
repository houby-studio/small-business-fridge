import { fetch, setGlobalDispatcher, Agent } from 'undici'
import { scheduleJob } from 'node-schedule'
import moment from 'moment'
import Product from '../models/product.js'
import logger from '../functions/logger.js'
moment.locale('cs')

setGlobalDispatcher(
  new Agent({
    connect: {
      rejectUnauthorized:
        process.env.ESL_JAMES_VERIFY_TLS.toLocaleLowerCase() === 'true'
    }
  })
)

const scheduledTask = scheduleJob(
  process.env.ESL_JAMES_INTEGRATION_CRON,
  function () {
    // This schedule can be disabled in the ENV
    if (process.env.ESL_JAMES_ENABLED.toLowerCase() !== 'true') {
      return
    }

    if (process.env.ESL_JAMES_STORE.length === 0) {
      logger.error(
        'server.tasks.continuousproductsjamesintegration__Store not provided for integration to JAMES ESL. Cannot sync products.'
      )
      return
    }

    logger.info(
      'server.tasks.continuousproductsjamesintegration__Started scheduled task to integrate products to JAMES ESL solution.'
    )

    // Aggregate products to integrate to JAMES
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
        $project: {
          keypadId: '$keypadId',
          displayName: '$displayName',
          description: '$description',
          imagePath: '$imagePath',
          category: '$category',
          code: '$code',
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
      .then(async (products) => {
        logger.debug(
          `server.tasks.continuousproductsjamesintegration__Successfully loaded ${products.length} products.`,
          {
            metadata: {
              result: products
            }
          }
        )
        // For each product contruct request for JAMES API
        let all_articles = []
        for (let i = 0; i < products.length; i++) {
          const article = {
            sku: `LIT_${products[i]._id.toString()}`,
            ean: products[i].code || '',
            store: process.env.ESL_JAMES_STORE || '',
            name: products[i].displayName,
            short_name: '',
            brand: '',
            price: products[i].stock[0]?.price || 0,
            price_30days: products[i].stock[0]?.price * 2 || 0,
            unit: '',
            place_of_origin: '',
            spec: products[i].category[0]?.name || '',
            qr_code: '',
            grade: '',
            description: products[i].description || '',
            supplier: '',
            facing: products[i].stockSum || 0,
            nfcUrl: `${process.env.MAIL_BASE_URL}/shop?addfavorite=${products[
              i
            ]._id.toString()}`,
            template: 'LIT'
          }
          all_articles.push(article)
        }
        fetch(process.env.ESL_JAMES_BASE_URL + '/item-bulk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.ESL_JAMES_API_KEY}`
          },
          body: JSON.stringify(all_articles)
        })
          .then((res) => {
            if (!res.ok) {
              const err = new Error(`HTTP ${res.status} ${res.statusText}`)
              err.status = res.status
              err.body = res.statusText
              throw err
            }
            logger.info(
              `server.tasks.continuousproductsjamesintegration__Uploaded ${all_articles.length} products to JAMES.`,
              {
                metadata: {
                  products_count: all_articles.length,
                  status: res.status
                }
              }
            )
          })
          .catch((err) => {
            logger.error(
              'server.tasks.continuousproductsjamesintegration__Failed to upload products to JAMES.',
              {
                metadata: {
                  error: err.message
                }
              }
            )
          })
      })
      .catch((err) => {
        logger.error(
          'server.tasks.continuousproductsjamesintegration__Failed to load products.',
          {
            metadata: {
              error: err.message
            }
          }
        )
      })
  }
)

export default scheduledTask
