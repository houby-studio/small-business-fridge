import { Router } from 'express'
import moment from 'moment'
import { sendMail } from '../functions/sendMail.js'
import Invoice from '../models/invoice.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import csrf from 'csurf'
import logger from '../functions/logger.js'
import { generateQR } from '../functions/qrPayment.js'
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
            element.status = 'Nezaplaceno'
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
            user: req.user.id,
            result: check
          }
        }
      )

      const subject =
        '[SECURITY INCIDENT] Pokus o změnu stavu faktury jiného dodavatele!'
      const message = `Dodavatel ID [${req.user._id}], zobrazované jméno [${req.user.displayName}] se pokusil změnit stav faktury ID [${check._id}], přestože ji nevytvořil. Systém tento pokus zablokobal. Zjistěte důvod této operace a proveďte nezbytné kroky vůči dané osobě, aby se to již neopakovalo.`
      sendMail('system@system', 'systemMessage', {
        subject,
        message,
        messageTime: moment().toISOString()
      })

      const alert = {
        type: 'danger',
        message: 'Nemáte oprávnění měnit stav faktury, kterou jste nevytvořil!',
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
          const friendlyInvoiceDate = moment(docs.invoiceDate).format('LLLL')
          const subject = `Platba potvrzena dodavatelem - ${req.user.displayName} - ${docs.totalCost} Kč`
          const mailPreview = `Faktura ze dne ${friendlyInvoiceDate} za ${docs.totalCost} Kč byla dodavatelem označena za zaplacenou.`

          sendMail(docs.buyerId.email, 'paymentsStatusChange', {
            subject,
            mailPreview,
            invoiceId: docs._id,
            invoiceDate: friendlyInvoiceDate,
            invoiceTotalCost: docs.totalCost,
            supplierDisplayName: req.user.displayName,
            customerDisplayName: docs.buyerId.displayName,
            paid: true
          })

          const alert = {
            type: 'success',
            message: 'Faktura byla označena jako zaplacená.',
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

          const friendlyInvoiceDate = moment(docs.invoiceDate).format('LLLL')
          const subject = `Platba odvolána dodavatelem - ${req.user.displayName} - ${docs.totalCost} Kč`
          const mailPreview = `Faktura ze dne ${friendlyInvoiceDate} za ${docs.totalCost} Kč byla dodavatelem označena za nezaplacenou.`

          sendMail(docs.buyerId.email, 'paymentsStatusChange', {
            subject,
            mailPreview,
            invoiceId: docs._id,
            invoiceDate: friendlyInvoiceDate,
            invoiceTotalCost: docs.totalCost,
            invoiceRequestPaid: docs.requestPaid,
            supplierDisplayName: req.user.displayName,
            customerDisplayName: docs.buyerId.displayName,
            paid: false
          })

          const alert = {
            type: 'success',
            message:
              'Platba byla stornována a faktura byla označena jako nezaplacená.',
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

// API called from client to show QR code
router.post('/qrcode', ensureAuthenticated, function (req, res, _next) {
  if (!req.user.supplier) {
    logger.warn(
      `server.routes.payments.qrcode.post__User tried to access supplier page without permission.`,
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.status(403).send()
    return
  }

  Invoice.findById(req.body.invoice_id)
    .populate('supplierId')
    .populate('buyerId')
    .then((invoice) => {
      // No invoice found
      if (!invoice) {
        res.status(404).send()
        return
      }
      // User manipulates someones elses invoice
      if (!invoice.supplierId.equals(req.user.id)) {
        logger.warn(
          `server.routes.payments.post__User:[${req.user.id}] tried to manipulate invoice:[${req.body.invoice_id}], which was not created by this user.`,
          {
            metadata: {
              user: req.user.id,
              result: invoice
            }
          }
        )
        console.log(invoice.supplierId)
        res.status(403).send()
        return
      }
      if (!invoice.supplierId.IBAN) {
        res.status(404).send('Supplier does not have IBAN')
      }
      generateQR(
        invoice.supplierId.IBAN,
        invoice.totalCost,
        invoice.buyerId.displayName,
        invoice.supplierId.displayName,
        (qrCode) => {
          res.status(200).send(qrCode)
        }
      )
    })
})

export default router
