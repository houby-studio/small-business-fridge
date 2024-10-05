import { fetch, setGlobalDispatcher, Agent } from 'undici'
import { scheduleJob } from 'node-schedule'
import moment from 'moment'
import Product from '../models/product.js'
import logger from '../functions/logger.js'
moment.locale('cs')

setGlobalDispatcher(
  new Agent({
    connect: {
      rejectUnauthorized: false
    }
  })
)

const scheduledTask = scheduleJob(
  process.env.ESL_AIMS_INTEGRATION_CRON,
  function () {
    // This schedule can be disabled in the ENV
    if (!process.env.ESL_AIMS_ENABLED) {
      return
    }

    logger.info(
      'server.tasks.continuousproductsaimsintegration__Started scheduled task to integrate products to AIMS ESL solution.'
    )

    // Aggregate products to integrate to AIMS
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
          `server.tasks.continuousproductsaimsintegration__Successfully loaded ${products.length} products.`,
          {
            metadata: {
              result: products
            }
          }
        )
        // For each product contruct request for AIMS API
        let all_articles = []
        for (let i = 0; i < products.length; i++) {
          const article = {
            articleId: products[i]._id.toString(),
            articleName: products[i].displayName,
            nfcUrl: `${process.env.MAIL_BASE_URL}/shop?addfavorie=${products[
              i
            ]._id.toString()}`,
            data: {
              STORE_CODE: null,
              ARTICLE_ID: products[i]._id.toString(),
              BARCODE: products[i].code || null,
              ITEM_NAME: products[i].displayName,
              ALIAS: null,
              SALE_PRICE: products[i].stock[0]?.price || 0,
              LIST_PRICE: products[i].stock[0]?.price * 2 || 0,
              UNIT_PRICE: null,
              ORIGIN: null,
              MANUFACTURER: null,
              TYPE: null,
              WEIGHT: null,
              WEIGHT_UNIT: null,
              UNIT_PRICE_UNIT: null,
              UNIT_DIMENSION: null,
              A_MARKER: null,
              R_MARKER: null,
              CATEGORY1: products[i].category[0]?.name || null,
              CATEGORY2: null,
              CATEGORY3: null,
              CATEGORY4: null,
              CATEGORY5: null,
              DISPLAY_TYPE: null,
              DISPLAY_TYPE2: null,
              DISPLAY_TYPE3: null,
              NFC_URL: products[i].category.name || null,
              ETC_0: products[i].stockSum || 0,
              ETC_1: null,
              ETC_2: null,
              ETC_3: null,
              ETC_4: null,
              ETC_5: null,
              ETC_6: null,
              ETC_7: null,
              ETC_8: null,
              ETC_9: null
            }
          }
          all_articles.push(article)
        }
        fetch(
          process.env.ESL_AIMS_BASE_URL +
            '/dashboardWeb/common/articles?store=' +
            process.env.ESL_AIMS_STORE,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              accept: 'application/json;charset=UTF-8'
            },
            body: JSON.stringify(all_articles)
          }
        )
          .then((msg) => {
            logger.info(
              `server.tasks.continuousproductsaimsintegration__Uploaded all_articles.length products to AIMS.`,
              {
                metadata: {
                  products_count: all_articles.length,
                  status: msg.status
                }
              }
            )
          })
          .catch((err) => {
            logger.error(
              'server.tasks.continuousproductsaimsintegration__Failed to upload products to AIMS.',
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
          'server.tasks.continuousproductsaimsintegration__Failed to load products.',
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
