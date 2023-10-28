import { Router } from 'express'
import moment from 'moment'
import { sendMail } from '../functions/sendMail.js'
import Invoice from '../models/invoice.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import csrf from 'csurf'
import logger from '../functions/logger.js'
var router = Router()
var csrfProtection = csrf()
router.use(csrfProtection)
moment.locale('cs')

// GET invoices page.
router.get('/', ensureAuthenticated, checkKiosk, function (req, res, _next) {
  var filter = {
    buyerId: req.user._id
  }

  // Invoice.aggregate invoices, lookup supplier display name and sum number of orders in invoice
  Invoice.aggregate([
    {
      $match: filter
    }, // Get only deliveries invoiced to current user requesting the page
    {
      $lookup: {
        from: 'users',
        localField: 'supplierId',
        foreignField: '_id',
        as: 'supplier'
      }
    }, // join on product
    {
      $unwind: '$supplier'
    },
    {
      $project: {
        _id: 1,
        'supplier.displayName': 1,
        'supplier.email': 1,
        paid: 1,
        requestPaid: 1,
        totalCost: 1,
        invoiceDate: 1,
        orders_sum: {
          $size: '$ordersId'
        }
      }
    }
  ])
    .then((docs) => {
      if (docs) {
        logger.debug(
          `server.routes.invoices.get__Successfully loaded ${docs.length} invoices.`,
          {
            metadata: {
              result: docs
            }
          }
        )
        docs.forEach(function (element) {
          element.invoiceDate_format = moment(element.invoiceDate).format(
            'LLLL'
          )
          element.invoiceDate = moment(element.invoiceDate).format()
          if (element.paid) {
            element.status = 'Uhrazeno'
          } else if (element.requestPaid) {
            element.status = 'Čeká na potvrzení'
          } else {
            element.status = 'Neuhrazeno'
          }
        })
      }
      let alert
      if (req.session.alert) {
        alert = req.session.alert
        delete req.session.alert
      }
      res.render('shop/invoices', {
        title: 'Faktury | Lednice IT',
        user: req.user,
        invoices: docs,
        alert: alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error('server.routes.invoices.get__Failed to load invoices.', {
        metadata: {
          error: err.message
        }
      })
      const alert = {
        type: 'danger',
        component: 'db',
        message: err.message,
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/')
      return
    })
})

// Form post - Handles Invoice "requestPaid" status changes
router.post('/', ensureAuthenticated, function (req, res, _next) {
  // Check if customer changes invoice which belongs to him
  Invoice.findById(req.body.invoice_id).then((check) => {
    if (!check.buyerId.equals(req.user.id)) {
      logger.warn(
        'server.routes.invoices.post__User attempted to change invoice which does not belong to him! Raising alert to system administrator.',
        {
          metadata: {
            user: req.user.id,
            result: check
          }
        }
      )
      const subject = 'Neoprávněná akce?!'
      const body = `<h1>Jak se toto podařilo?!</h1><p>Zákazník ${req.body.displayName} se pokouší manipulovat s fakturou ID ${check._id}, přestože ji nevlastní.</p>Žádná akce nebyla provedena. Prověřte celou situaci!</p>`
      sendMail('system@system', subject, body)
      const alert = {
        type: 'danger',
        message: 'Nemáte oprávnění měnit status faktury, která Vám nepatří!',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/invoices')
      return
    }
    if (check.paid === true) {
      logger.warn(
        'server.routes.invoices.post__User attempted to change invoice status to paid, although supplier already confirmed on his end.',
        {
          metadata: {
            user: req.user.id,
            result: check
          }
        }
      )
      const alert = {
        type: 'danger',
        message:
          'Faktura již byla označena dodavatelem jako uhrazená, není nutné ji tedy označovat z Vaší strany.',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/invoices')
      return
    }

    if (req.body.action === 'paid') {
      // Handles status change to 'requestPaid: true'
      Invoice.findByIdAndUpdate(
        req.body.invoice_id,
        {
          requestPaid: true
        },
        {
          upsert: true
        }
      )
        .populate('supplierId')
        .then((docs) => {
          logger.info(
            `server.routes.invoices.post__User [${req.user.displayName}] marked invoice ${req.body.invoice_id} as paid.`,
            {
              metadata: {
                result: docs
              }
            }
          )

          const friendlyInvoiceDate = moment(docs.invoiceDate).format('LLLL')
          const subject = `Faktura byla označena za zaplacenou - ${req.user.displayName} - ${docs.totalCost}`
          const mailPreview = `Faktura ze dne ${friendlyInvoiceDate} za ${docs.totalCost} Kč čeká na potvrzení z Vaší strany.`

          sendMail(docs.supplierId.email, 'invoicesStatusChange', {
            subject,
            mailPreview,
            invoiceId: docs._id,
            invoiceDate: friendlyInvoiceDate,
            invoiceTotalCost: docs.totalCost,
            customerDisplayName: req.user.displayName,
            paid: true
          })

          const alert = {
            type: 'success',
            message:
              'Faktura byla z Vaší strany označena jako uhrazená. Vyčkejte na schválení ze strany dodavatele.',
            success: 1
          }
          req.session.alert = alert
          res.redirect('/invoices')
        })
        .catch((err) => {
          logger.error(
            `server.routes.invoices.post__User [${req.user.displayName}] failed to mark invoice ${req.body.invoice_id} as paid.`,
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
          res.redirect('/invoices')
          return
        })
    } else if (req.body.action === 'storno') {
      // Handles status change to 'requestPaid: false'
      Invoice.findByIdAndUpdate(
        req.body.invoice_id,
        {
          requestPaid: false
        },
        {
          upsert: true
        }
      )
        .populate('supplierId')
        .then((docs) => {
          logger.info(
            `server.routes.invoices.post__User [${req.user.displayName}] marked invoice ${req.body.invoice_id} as unpaid (undo confirmation).`,
            {
              metadata: {
                result: docs
              }
            }
          )

          const friendlyInvoiceDate = moment(docs.invoiceDate).format('LLLL')
          const subject = `Faktura byla označena za nezaplacenou - ${req.user.displayName} - ${docs.totalCost}`
          const mailPreview = `Faktura ze dne ${friendlyInvoiceDate} za ${docs.totalCost} Kč byla zákazníkem označena za nezaplacenou.`

          sendMail(docs.supplierId.email, 'invoicesStatusChange', {
            subject,
            mailPreview,
            invoiceId: docs._id,
            invoiceDate: friendlyInvoiceDate,
            invoiceTotalCost: docs.totalCost,
            customerDisplayName: req.user.displayName,
            paid: false
          })

          const alert = {
            type: 'success',
            message:
              'Platba byla z Vaší strany zrušena. Prosíme uhraďte fakturu co nejdříve.',
            success: 1
          }
          req.session.alert = alert
          res.redirect('/invoices')
        })
        .catch((err) => {
          logger.error(
            `server.routes.invoices.post__User [${req.user.displayName}] failed to mark invoice ${req.body.invoice_id} as unpaid (undo confirmation).`,
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
          res.redirect('/invoices')
          return
        })
    } else {
      logger.warn(
        `server.routes.invoices.post__User [${req.user.displayName}] tried to call invalid action.`,
        {
          metadata: {
            result: req.body.action
          }
        }
      )
      const alert = {
        type: 'danger',
        component: 'web',
        message: 'Při zpracování došlo k chybě. Požadovaná akce neexistuje!',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/invoices')
    }
  })
})

export default router
