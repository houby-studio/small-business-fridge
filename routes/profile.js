import { Router } from 'express'
import csrf from 'csurf'
import User from '../models/user.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import logger from '../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)

/* GET profile page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  res.render('shop/profile', {
    title: 'Profil | Lednice IT',
    user: req.user,
    csrfToken: req.csrfToken()
  })
})

/* POST profile page. */
router.post('/', ensureAuthenticated, function (req, res) {
  const newValue = req.body.value
  if (req.body.name === 'checkAllProducts') {
    User.findByIdAndUpdate(
      req.user.id,
      {
        showAllProducts: newValue
      },
      {
        upsert: true
      }
    )
      .then(() => {
        logger.info(
          `server.routes.profile.post__User:[${req.user.displayName}] set preference showAllProducts:[${newValue}].`,
          {
            metadata: {
              result: req.user
            }
          }
        )
        res.status(200).send()
      })
      .catch((err) => {
        logger.error(
          `server.routes.profile.post__Failed to set preference showAllProducts:[${newValue}] for user:[${req.user.displayName}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else if (req.body.name === 'checkSendEmailEshop') {
    User.findByIdAndUpdate(req.user.id, {
      sendMailOnEshopPurchase: newValue
    })
      .then(() => {
        logger.info(
          `server.routes.profile.post__User:[${req.user.displayName}] set preference sendMailOnEshopPurchase:[${newValue}].`,
          {
            metadata: {
              result: req.user
            }
          }
        )
        res.status(200).send()
      })
      .catch((err) => {
        logger.error(
          `server.routes.profile.post__Failed to set preference sendMailOnEshopPurchase:[${newValue}] for user:[${req.user.displayName}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else if (req.body.name === 'checkSendDailyReport') {
    User.findByIdAndUpdate(req.user.id, {
      sendDailyReport: newValue
    })
      .then(() => {
        logger.info(
          `server.routes.profile.post__User:[${req.user.displayName}] set preference sendDailyReport:[${newValue}].`,
          {
            metadata: {
              result: req.user
            }
          }
        )
        res.status(200).send()
      })
      .catch((err) => {
        logger.error(
          `server.routes.profile.post__Failed to set preference sendDailyReport:[${newValue}] for user:[${req.user.displayName}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else if (req.body.name === 'realtime-iban') {
    if (/^CZ\d{22}$/.test(newValue)) {
      User.findByIdAndUpdate(req.user.id, {
        IBAN: newValue
      })
        .then(() => {
          logger.info(
            `server.routes.profile.post__User:[${req.user.displayName}] set new IBAN:[${newValue}].`,
            {
              metadata: {
                result: req.user
              }
            }
          )
          res.status(200).send()
        })
        .catch((err) => {
          logger.error(
            `server.routes.profile.post__Failed to set IBAN:[${newValue}] for user:[${req.user.displayName}].`,
            {
              metadata: {
                error: err.message
              }
            }
          )
          res.status(400).send()
        })
    } else {
      logger.warn(
        `server.routes.profile.post__User:[${req.user.displayName}] tried to set invalid IBAN:[${newValue}].`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.status(400).send()
    }
  } else if (req.body.name === 'favorite') {
    const operation = newValue?.state ? '$push' : '$pull'
    User.findByIdAndUpdate(req.user.id, {
      [operation]: {
        favorites: newValue?.product
      }
    })
      .then(() => {
        logger.info(
          `server.routes.profile.post__User:[${req.user.displayName}] added/removed favorite:[${newValue?.product}].`,
          {
            metadata: {
              result: req.user
            }
          }
        )
        res.status(200).send()
      })
      .catch((err) => {
        logger.error(
          `server.routes.profile.post__Failed to add/remove favorite for user:[${req.user.displayName}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else if (req.body.name === 'colormode') {
    User.findByIdAndUpdate(req.user.id, {
      colorMode: newValue
    })
      .then(() => {
        logger.info(
          `server.routes.profile.post__User:[${req.user.displayName}] changed color mode:[${newValue}].`,
          {
            metadata: {
              result: req.user
            }
          }
        )
        res.status(200).send()
      })
      .catch((err) => {
        logger.error(
          `server.routes.profile.post__Failed to change color mode for user:[${req.user.displayName}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else if (req.body.name === 'checkDisableKeypadLogin') {
    User.findByIdAndUpdate(req.user.id, {
      keypadDisabled: newValue
    })
      .then(() => {
        logger.info(
          `server.routes.profile.post__User:[${req.user.displayName}] set preference checkDisableKeypadLogin:[${newValue}].`,
          {
            metadata: {
              result: req.user
            }
          }
        )
        res.status(200).send()
      })
      .catch((err) => {
        logger.error(
          `server.routes.profile.post__Failed to set preference checkDisableKeypadLogin:[${newValue}] for user:[${req.user.displayName}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else {
    res.status(400).send()
  }
})

export default router
