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
  Product.find()
    .then((docs) => {
      if (docs) {
        logger.debug(
          `server.routes.eslmapping.get__Successfully loaded ${docs.length} products.`,
          {
            metadata: {
              result: docs
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
              products: docs,
              labels: labels,
              alert,
              user: req.user,
              csrfToken: req.csrfToken()
            })
          })
        })
        .catch((err) => {
          logger.error('server.routes.eslmapping.get__Failed to load labels.', {
            metadata: {
              error: err.message
            }
          })
        })
    })
    .catch((err) => {
      logger.error('server.routes.eslmapping.get__Failed to load products.', {
        metadata: {
          error: err.message
        }
      })
    })
})

/* POST admin_users page. */
// router.post('/', ensureAuthenticated, function (req, res) {
//   if (!req.user.admin) {
//     logger.warn(
//       "server.routes.eslmapping.post__User tried to change user's properties on admin page without permission.",
//       {
//         metadata: {
//           result: req.user
//         }
//       }
//     )
//     res.status(400).send()
//     return
//   }
//   const newValue = req.body.value
//   if (req.body.name === 'supplier') {
//     User.findByIdAndUpdate(
//       req.body.user,
//       {
//         supplier: newValue
//       },
//       {
//         upsert: true
//       }
//     )
//       .then(() => {
//         logger.info(
//           `server.routes.eslmapping.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
//           {
//             metadata: {
//               result: req.user
//             }
//           }
//         )
//         res.status(200).send()
//       })
//       .catch((err) => {
//         logger.error(
//           `server.routes.eslmapping.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
//           {
//             metadata: {
//               error: err.message
//             }
//           }
//         )
//         res.status(400).send()
//       })
//   } else if (req.body.name === 'admin') {
//     User.findByIdAndUpdate(
//       req.body.user,
//       {
//         admin: newValue
//       },
//       {
//         upsert: true
//       }
//     )
//       .then(() => {
//         logger.info(
//           `server.routes.eslmapping.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
//           {
//             metadata: {
//               result: req.user
//             }
//           }
//         )
//         res.status(200).send()
//       })
//       .catch((err) => {
//         logger.error(
//           `server.routes.eslmapping.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
//           {
//             metadata: {
//               error: err.message
//             }
//           }
//         )
//         res.status(400).send()
//       })
//   } else if (req.body.name === 'card') {
//     if (/.{6,}/.test(newValue)) {
//       User.findByIdAndUpdate(req.body.user, {
//         card: newValue
//       })
//         .then(() => {
//           logger.info(
//             `server.routes.eslmapping.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
//             {
//               metadata: {
//                 result: req.user
//               }
//             }
//           )
//           res.status(200).send()
//         })
//         .catch((err) => {
//           logger.error(
//             `server.routes.eslmapping.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
//             {
//               metadata: {
//                 error: err.message
//               }
//             }
//           )
//           res.status(400).send()
//         })
//     } else {
//       logger.warn(
//         `server.routes.eslmapping.post__User:[${req.user.displayName}] tried to set invalid property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
//         {
//           metadata: {
//             result: req.user
//           }
//         }
//       )
//       res.status(400).send()
//     }
//   } else if (req.body.name === 'keypad') {
//     if (/^[0-9]{1,3}$/.test(newValue)) {
//       User.findByIdAndUpdate(req.body.user, {
//         keypadId: newValue
//       })
//         .then(() => {
//           logger.info(
//             `server.routes.eslmapping.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
//             {
//               metadata: {
//                 result: req.user
//               }
//             }
//           )
//           res.status(200).send()
//         })
//         .catch((err) => {
//           logger.error(
//             `server.routes.eslmapping.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
//             {
//               metadata: {
//                 error: err.message
//               }
//             }
//           )
//           res.status(400).send()
//         })
//     } else {
//       logger.warn(
//         `server.routes.eslmapping.post__User:[${req.user.displayName}] tried to set invalid property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
//         {
//           metadata: {
//             result: req.user
//           }
//         }
//       )
//       res.status(400).send()
//     }
//   } else if (req.body.name === 'deactivate') {
//     User.findByIdAndUpdate(req.body.user, {
//       $set: {
//         displayName: 'Bývalý uživatel',
//         email: 'byvaly@uzivatel',
//         admin: false,
//         supplier: false,
//         kiosk: false,
//         showAllProducts: false,
//         sendMailOnEshopPurchase: false,
//         sendDailyReport: false,
//         keypadDisabled: true,
//         disabled: true
//       },
//       $unset: {
//         keypadId: 1,
//         favorites: 1,
//         IBAN: 1,
//         colorMode: 1,
//         theme: 1,
//         card: 1
//       }
//     })
//       .then((user) => {
//         logger.info(
//           `server.routes.eslmapping.post__User:[${req.user.displayName}] deactivated user:[${req.body.user}].`,
//           {
//             metadata: {
//               result: req.user
//             }
//           }
//         )
//         const alert = {
//           type: 'success',
//           message: `Uživatel ${user.email} byl deaktivován.`,
//           success: 1
//         }
//         req.session.alert = alert
//         res.redirect('/admin_users')
//       })
//       .catch((err) => {
//         logger.error(
//           `server.routes.eslmapping.post__Failed to deactivate user:[${req.user.displayName}].`,
//           {
//             metadata: {
//               error: err.message
//             }
//           }
//         )
//         const alert = {
//           type: 'danger',
//           component: 'db',
//           message: err.message,
//           danger: 1
//         }
//         req.session.alert = alert
//         res.redirect('/admin_users')
//       })
//   } else {
//     res.status(400).send()
//   }
// })

export default router
