import { Router } from 'express'
import csrf from 'csurf'
import User from '../../models/user.js'
import { ensureAuthenticated } from '../../functions/ensureAuthenticated.js'
import { checkKiosk } from '../../functions/checkKiosk.js'
import logger from '../../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)

/* GET admin_users page. */
router.get('/', ensureAuthenticated, checkKiosk, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      'server.routes.adminusers.get__User tried to access admin page without permission.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  User.find()
    .then((docs) => {
      if (docs) {
        logger.debug(
          `server.routes.adminusers.get__Successfully loaded ${docs.length} users.`,
          {
            metadata: {
              result: docs
            }
          }
        )
      }

      res.render('admin/admin_users', {
        title: 'Uživatelé | Lednice IT',
        users: docs,
        alert,
        user: req.user,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error('server.routes.adminusers.get__Failed to load users.', {
        metadata: {
          error: err.message
        }
      })
    })
})

/* POST admin_users page. */
router.post('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      "server.routes.adminusers.post__User tried to change user's properties on admin page without permission.",
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.status(400).send()
    return
  }
  const newValue = req.body.value
  if (req.body.name === 'supplier') {
    User.findByIdAndUpdate(
      req.body.user,
      {
        supplier: newValue
      },
      {
        upsert: true
      }
    )
      .then(() => {
        logger.info(
          `server.routes.adminusers.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
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
          `server.routes.adminusers.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else if (req.body.name === 'admin') {
    User.findByIdAndUpdate(
      req.body.user,
      {
        admin: newValue
      },
      {
        upsert: true
      }
    )
      .then(() => {
        logger.info(
          `server.routes.adminusers.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
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
          `server.routes.adminusers.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        res.status(400).send()
      })
  } else if (req.body.name === 'card') {
    if (/.{6,}/.test(newValue)) {
      User.findByIdAndUpdate(req.body.user, {
        card: newValue
      })
        .then(() => {
          logger.info(
            `server.routes.adminusers.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
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
            `server.routes.adminusers.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
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
        `server.routes.adminusers.post__User:[${req.user.displayName}] tried to set invalid property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.status(400).send()
    }
  } else if (req.body.name === 'keypad') {
    if (/^[0-9]{1,3}$/.test(newValue)) {
      User.findByIdAndUpdate(req.body.user, {
        keypadId: newValue
      })
        .then(() => {
          logger.info(
            `server.routes.adminusers.post__User:[${req.user.displayName}] changed property:[${req.body.name}] for user:[${req.body.user}] to new value:[${newValue}].`,
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
            `server.routes.adminusers.post__Failed to set property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
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
        `server.routes.adminusers.post__User:[${req.user.displayName}] tried to set invalid property:[${req.body.name}] for user:[${req.user.displayName}] to new value:[${newValue}].`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.status(400).send()
    }
  } else if (req.body.name === 'deactivate') {
    User.findByIdAndUpdate(req.body.user, {
      $set: {
        displayName: 'Bývalý uživatel',
        email: 'byvaly@uzivatel',
        admin: false,
        supplier: false,
        kiosk: false,
        showAllProducts: false,
        sendMailOnEshopPurchase: false,
        sendDailyReport: false,
        keypadDisabled: true,
        disabled: true
      },
      $unset: {
        keypadId: 1,
        favorites: 1,
        IBAN: 1,
        colorMode: 1,
        theme: 1,
        card: 1
      }
    })
      .then((user) => {
        logger.info(
          `server.routes.adminusers.post__User:[${req.user.displayName}] deactivated user:[${req.body.user}].`,
          {
            metadata: {
              result: req.user
            }
          }
        )
        const alert = {
          type: 'success',
          message: `Uživatel ${user.email} byl deaktivován.`,
          success: 1
        }
        req.session.alert = alert
        res.redirect('/admin_users')
      })
      .catch((err) => {
        logger.error(
          `server.routes.adminusers.post__Failed to deactivate user:[${req.user.displayName}].`,
          {
            metadata: {
              error: err.message
            }
          }
        )
        const alert = {
          type: 'danger',
          component: 'db',
          message: err.message,
          danger: 1
        }
        req.session.alert = alert
        res.redirect('/admin_users')
      })
  } else {
    res.status(400).send()
  }
})

export default router
