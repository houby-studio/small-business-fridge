import { Router } from 'express'
import moment from 'moment'
import csrf from 'csurf'
import { fetch, setGlobalDispatcher, Agent } from 'undici'
import Product from '../models/product.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import logger from '../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)
moment.locale('cs')

/* GET esl_mapping page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      'server.routes.eslmapping.get__User tried to access supplier page without permission.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  if (process.env.ESL_AIMS_ENABLED.toLowerCase() !== 'true') {
    const alert = {
      type: 'danger',
      component: 'esl',
      message: 'ESL cenovky nejsou v nastavení povolené.',
      danger: 1
    }
    req.session.alert = alert
    res.redirect('/')
    return
  }

  setGlobalDispatcher(
    new Agent({
      connect: {
        rejectUnauthorized:
          process.env.ESL_AIMS_VERIFY_TLS.toLocaleLowerCase() === 'true'
      }
    })
  )

  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
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
      $project: {
        code: '$code',
        displayName: '$displayName',
        imagePath: '$imagePath',
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
      if (products) {
        logger.debug(
          `server.routes.eslmapping.get__Successfully loaded ${products.length} products.`,
          {
            metadata: {
              result: products
            }
          }
        )
      }

      fetch(
        process.env.ESL_AIMS_BASE_URL +
          '/dashboardWeb/common/labels?store=' +
          process.env.ESL_AIMS_STORE,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            accept: 'application/json;charset=UTF-8'
          }
        }
      )
        .then((response) => {
          const mappedProducts = products.map((product) => {
            return {
              _id: product._id,
              code: product.code,
              product_name: product.displayName,
              product_image: product.imagePath,
              stock: product.stockSum,
              price: product.stock[0]?.price || 0
            }
          })
          response.json().then((json) => {
            const labels = json.labelList.map((item) => ({
              labelCode: item.labelCode,
              type: item.type,
              networkStatus: item.networkStatus,
              updateStatus: item.updateStatus,
              temperature: item.temperature,
              requestDate: item.requestDate
                ? moment(item.requestDate).format('LLLL')
                : null,
              articleId: item.articleList[0]?.articleId,
              articleName: item.articleList[0]?.articleName
            }))
            res.render('shop/esl_mapping', {
              title: 'Elektronické cenovky | Lednice IT',
              products: mappedProducts,
              labels: labels,
              alert,
              user: req.user,
              csrfToken: req.csrfToken()
            })
          })
        })
        .catch((err) => {
          logger.error(
            'server.routes.eslmapping.get__Failed to load labels from AIMS.',
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
        'server.routes.eslmapping.get__Failed to load products from database.',
        {
          metadata: {
            error: err.message
          }
        }
      )
    })
})

/* POST esl_mapping page. */
router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.supplier) {
    logger.warn(
      'server.routes.eslmapping.post__User tried to change ESL tag on supplier page without permission.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }
  if (req.body.name === 'link') {
    const body = {
      assignList: [
        {
          articleIdList: [req.body.product_id],
          labelCode: req.body.label_id
        }
      ]
    }
    fetch(
      process.env.ESL_AIMS_BASE_URL +
        '/dashboardWeb/common/labels/link?store=' +
        process.env.ESL_AIMS_STORE,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          accept: 'application/json;charset=UTF-8'
        },
        body: JSON.stringify(body)
      }
    )
      .then(() => {
        // validateDeletion(req.body.label_id, () => {}) - If we want to wait for AIMS propagation, encapsulate in this.
        const alert = {
          type: 'success',
          message: `Produkt ${req.body.product_id} navázán na elektronickou cenovku ${req.body.label_id}. Změny se brzy projeví.`,
          success: 1
        }
        req.session.alert = alert
        res.redirect('/esl_mapping')
        logger.info(
          `server.routes.eslmapping.post__Successfully set product ${req.body.product_id} to label ${req.body.label_id}.`,
          {
            metadata: {
              label_id: req.body.label_id,
              product_id: req.body.product_id
            }
          }
        )
        return
      })
      .catch((err) => {
        const alert = {
          type: 'danger',
          component: 'web',
          message: 'Nepodařilo se odstranit produkt z elektronické cenovky.',
          danger: 1
        }
        req.session.alert = alert
        res.redirect('/esl_mapping')
        logger.error(
          'server.routes.eslmapping.post__Failed to delete product from ESL.',
          {
            metadata: {
              error: err.message
            }
          }
        )
      })
  } else if (req.body.name === 'unlink') {
    const body = { unAssignList: [req.body.label_id] }
    fetch(
      process.env.ESL_AIMS_BASE_URL +
        '/dashboardWeb/common/labels/unlink?store=' +
        process.env.ESL_AIMS_STORE,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          accept: 'application/json;charset=UTF-8'
        },
        body: JSON.stringify(body)
      }
    )
      .then(() => {
        // validateDeletion(req.body.label_id, () => {}) - If we want to wait for AIMS propagation, encapsulate in this.
        const alert = {
          type: 'success',
          message: `Odstranili jste produkt z elektronické cenovky ${req.body.label_id}. Změny se brzy projeví.`,
          success: 1
        }
        req.session.alert = alert
        res.redirect('/esl_mapping')
        logger.info(
          `server.routes.eslmapping.post__Successfully deleted product from label ${req.body.label_id}.`,
          {
            metadata: {
              label_id: req.body.label_id,
              product_id: req.body.product_id
            }
          }
        )
        return
      })
      .catch((err) => {
        const alert = {
          type: 'danger',
          component: 'web',
          message: 'Nepodařilo se odstranit produkt z elektronické cenovky.',
          danger: 1
        }
        req.session.alert = alert
        res.redirect('/esl_mapping')
        logger.error(
          'server.routes.eslmapping.post__Failed to delete product from ESL.',
          {
            metadata: {
              error: err.message
            }
          }
        )
      })
  } else {
    const alert = {
      type: 'danger',
      component: 'web',
      message: 'Pokusili jste se odeslat neplatný formulář.',
      danger: 1
    }
    req.session.alert = alert
    res.redirect('/esl_mapping')
  }
})

export default router

// * This function waits until the AIMS reports the label without product, but currently it takes about 25 seconds. *
// function validateDeletion(labelId, callback) {
//   logger.debug(`server.routes.eslmapping.post__Calling validate deletion.`, {
//     metadata: {
//       labelId: labelId
//     }
//   })
//   setTimeout(() => {
//     fetch(
//       process.env.ESL_AIMS_BASE_URL +
//         '/dashboardWeb/common/labels/detail?label=' +
//         labelId +
//         '&store=' +
//         process.env.ESL_AIMS_STORE,
//       {
//         method: 'GET',
//         headers: {
//           'Content-Type': 'application/json;charset=UTF-8',
//           accept: 'application/json;charset=UTF-8'
//         }
//       }
//     )
//       .then((result) => {
//         result
//           .json()
//           .then((json) => {
//             if (json.currentImage?.[0]) {
//               validateDeletion(labelId, callback)
//               return
//             } else {
//               callback()
//             }
//           })
//           .catch((err) => {
//             validateDeletion(labelId, callback)
//             logger.error(
//               'server.routes.eslmapping.post__Failed to validate deletion.',
//               {
//                 metadata: {
//                   error: err.message
//                 }
//               }
//             )
//           })
//       })
//       .catch((err) => {
//         logger.error(
//           'server.routes.eslmapping.post__Failed to validate deletion.',
//           {
//             metadata: {
//               error: err.message
//             }
//           }
//         )
//       })
//   }, 200)
// }
