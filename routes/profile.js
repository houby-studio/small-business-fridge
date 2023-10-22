import { Router } from 'express'
import User from '../models/user.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import logger from '../functions/logger.js'
var router = Router()

/* GET profile page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res, _next) {
  res.render('shop/profile', {
    title: 'Profil | Lednice IT',
    user: req.user
  })
})

router.post('/', ensureAuthenticated, function (req, res, _next) {
  var newValue = req.body.value
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
        return
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
        return
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
        return
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
        return
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
        return
      })
  } else if (req.body.name === 'realtime-iban') {
    if (/^CZ\d{22}$/.test(req.body.value)) {
      User.findByIdAndUpdate(req.user.id, {
        IBAN: req.body.value
      })
        .then(() => {
          logger.info(
            `server.routes.profile.post__User:[${req.user.displayName}] set new IBAN:[${req.body.value}].`,
            {
              metadata: {
                result: req.user
              }
            }
          )
          res.status(200).send()
          return
        })
        .catch((err) => {
          logger.error(
            `server.routes.profile.post__Failed to set IBAN:[${req.body.value}] for user:[${req.user.displayName}].`,
            {
              metadata: {
                error: err.message
              }
            }
          )
          res.status(400).send()
          return
        })
    } else {
      logger.warn(
        `server.routes.profile.post__User:[${req.user.displayName}] tried to set invalid IBAN:[${req.body.value}].`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.status(400).send()
      return
    }
  }
})

export default router
