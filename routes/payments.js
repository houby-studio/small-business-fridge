import { Router } from 'express'
import moment from 'moment'
import { sendMail } from '../functions/sendMail.js'
import Invoice from '../models/invoice.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import csrf from 'csurf'
import logger from '../functions/logger.js'
var router = Router()
var csrfProtection = csrf()
router.use(csrfProtection)
moment.locale('cs')

/* GET supplier payments page. */
router.get('/', ensureAuthenticated, function (req, res, _next) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.payments.get__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  var filter
  if (req.baseUrl === '/admin_payments') {
    if (!req.user.admin) {
      logger.warn(
        `server.routes.payments.get__User tried to access admin page without permission.`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.redirect('/')
      return
    }
    filter = {}
  } else {
    filter = {
      supplierId: req.user._id
    }
  }

  // Invoice.aggregate invoices, lookup buyer display name and sum number of orders in invoice
  Invoice.aggregate([
    {
      $match: filter
    }, // Get only deliveries inserted by supplier requesting the page
    {
      $lookup: {
        from: 'users',
        localField: 'buyerId',
        foreignField: '_id',
        as: 'buyer'
      }
    }, // join on product
    {
      $unwind: '$buyer'
    },
    {
      $project: {
        _id: 1,
        'buyer.displayName': 1,
        'buyer.email': 1,
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
          `server.routes.payments.get__Successfully loaded ${docs.length} payments.`,
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
            element.status = 'Zaplaceno'
          } else if (element.requestPaid) {
            element.status = 'Kontrola platby'
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
      res.render('shop/payments', {
        title: 'Platby | Lednice IT',
        user: req.user,
        invoices: docs,
        supplier: filter,
        alert: alert,
        csrfToken: req.csrfToken()
      })
    })
    .catch((err) => {
      logger.error(`server.routes.payments.get__Failed to load payments.`, {
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

// Form post - Handles Invoice "paid" status changes
router.post('/', ensureAuthenticated, function (req, res, _next) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.payments.post__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }

  if (req.baseUrl === '/admin_payments') {
    if (!req.user.admin) {
      logger.warn(
        `server.routes.payments.post__User tried to access admin page without permission.`,
        {
          metadata: {
            result: req.user
          }
        }
      )
      res.redirect('/')
      return
    }
    logger.warn(
      `server.routes.payments.post__Admin tried to modify payment from admin dashboard.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    const alert = {
      type: 'danger',
      message: 'Změna stavu platby z administrátorského pohledu je zakázána!',
      danger: 1
    }
    req.session.alert = alert
    res.redirect('/admin_payments')
    return
  }

  // Check if supplier changes invoice he owns
  Invoice.findById(req.body.invoice_id).then((check) => {
    if (!check.supplierId.equals(req.user.id)) {
      logger.warn(
        `server.routes.payments.post__User:[${req.user.id}] tried to manipulate invoice:[${req.body.invoice_id}], which was not created by this user.`,
        {
          metadata: {
            error: err.message
          }
        }
      )
      var subject = 'Neoprávněná akce?!'
      var body = `<h1>Jak se toto podařilo?!</h1><p>Dodavatel ${req.body.displayName} se pokouší manipulovat s fakturou ID ${check._id}, přestože ji nevytvořil.</p>Jeho akce byla revertována. Prověřte celou situaci!</p>`
      sendMail('system@system', subject, body)
      const alert = {
        type: 'danger',
        message:
          'Nemáte oprávnění měnit status faktury, kterou jste nevytvořil!',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/payments')
      return
    }

    if (req.body.action === 'approve') {
      // Handles status change to 'paid: true'
      Invoice.findByIdAndUpdate(
        req.body.invoice_id,
        {
          paid: true
        },
        {
          upsert: true
        }
      )
        .populate('buyerId')
        .then((docs) => {
          logger.info(
            `server.routes.payments.post__Supplier:[${req.user.displayName}] marked invoice:[${req.body.invoice_id}] as paid.`,
            {
              metadata: {
                result: docs
              }
            }
          )
          // const subject = `${noticeCount}. výzva k úhradě faktury po splatnosti`
          // const mailPreview = `Částka k úhradě ${docs[i].totalCost} Kč.`

          // sendMail(docs[i].buyer[0].email, 'unpaidInvoiceNotice', {
          //   subject,
          //   mailPreview,
          //   invoiceId: docs[i]._id,
          //   invoiceDate: moment(docs[i].invoiceDate).format('LLLL'),
          //   invoiceTotalCost: docs[i].totalCost,
          //   noticeCount: noticeCount,
          //   supplierDisplayName: docs[i].supplier[0].displayName,
          //   supplierIBAN: docs[i].supplier[0].IBAN,
          //   qrImageData,
          //   qrText
          // })

          const subject = 'Vaše platba byla potvrzena!'
          const body = `<h1>Obchod byl dokončen!</h1><p>Váš dodavatel ${
            req.user.displayName
          } potvrdil, že jste fakturu uhradil!</p><p>Podrobnosti k faktuře:<br>Datum fakturace: ${moment(
            docs.invoiceDate
          ).format('LLLL')}<br>Celková částka k úhradě: ${docs.totalCost}Kč</p>`
          sendMail(docs.buyerId.email, subject, body)

          const alert = {
            type: 'success',
            message: 'Faktura byla označena jako uhrazená.',
            success: 1
          }
          req.session.alert = alert
          res.redirect('/payments')
        })
        .catch((err) => {
          logger.error(
            `server.routes.payments.post__Failed to mark invoice:[${req.body.invoice_id}] as paid.`,
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
          res.redirect('/payments')
          return
        })
    } else if (req.body.action === 'storno') {
      // Handles status change to 'paid: false'
      Invoice.findByIdAndUpdate(
        req.body.invoice_id,
        {
          paid: false
        },
        {
          upsert: true
        }
      )
        .populate('buyerId')
        .then((docs) => {
          logger.info(
            `server.routes.payments.post__Supplier:[${req.user.displayName}] marked invoice:[${req.body.invoice_id}] as unpaid (undo confirmation).`,
            {
              metadata: {
                result: docs
              }
            }
          )
          const subject = 'Vaše platba byla stornována!'
          const body = `<h1>Jak je toto možné?</h1><p>Váš dodavatel ${
            req.user.displayName
          } označil Vaši fakturu s datem vytvoření ${moment(
            docs.invoiceDate
          ).format('LLLL')} a celkovou částkou k úhradě ${
            docs.totalCost
          }Kč za nezaplacenou. Vyřiďte si s ním kde nastala chyba.</p>`
          sendMail(docs.buyerId.email, subject, body)
          const alert = {
            type: 'success',
            message:
              'Platba byla stornována a faktura byla označena jako neuhrazená.',
            success: 1
          }
          req.session.alert = alert
          res.redirect('/payments')
        })
        .catch((err) => {
          logger.error(
            `server.routes.payments.post__Failed to mark invoice:[${req.body.invoice_id}] as unpaid (undo confirmation).`,
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
          res.redirect('/payments')
          return
        })
    } else {
      logger.warn(
        `server.routes.payments.post__User [${req.user.displayName}] tried to call invalid action.`,
        {
          metadata: {
            result: req.body.action
          }
        }
      )
      alert = {
        type: 'danger',
        component: 'web',
        message: 'Při zpracování došlo k chybě. Požadovaná akce neexistuje!',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/payments')
    }
  })
})

export default router
