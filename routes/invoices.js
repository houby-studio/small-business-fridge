import { Router } from 'express'
var router = Router()
import moment from 'moment'
moment.locale('cs')
import { sendMail } from '../functions/sendMail.js'
import Invoice from '../models/invoice.js'
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'
import { checkKiosk } from '../functions/checkKiosk.js'
import csrf from 'csurf'
var csrfProtection = csrf()
router.use(csrfProtection)

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
      const subject = 'Neoprávněná akce?!'
      const body = `<h1>Jak se toto podařilo?!</h1><p>Zákazník ${req.body.displayName} se pokouší manipulovat s fakturou ID ${check._id}, přestože ji nevlastní.</p>Jeho akce byla revertována. Prověřte celou situaci!</p>`
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
          const subject = `Zákazník ${req.user.displayName} uhradil fakturu!`
          const body = `<h1>Penízky už se sypou!</h1><p>Zákazník ${
            req.user.displayName
          } označil fakturu od Vás s datem vytvoření ${moment(
            docs.invoiceDate
          ).format('LLLL')} a celkovou částkou k úhradě ${
            docs.totalCost
          } za zaplacenou.</p><p>Zkontrolujte zda se tak stalo a následně potvrďte na webu přes tento odkaz</p>`
          sendMail(docs.supplierId.email, subject, body)
          const alert = {
            type: 'success',
            message:
              'Faktura byla označena jako uhrazená u dodavatele. Vyčkejte na schválení.',
            success: 1
          }
          req.session.alert = alert
          res.redirect('/invoices')
        })
        .catch((err) => {
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
          var subject = `Zákazník ${req.user.displayName} stornoval platbu faktury!`
          var body = `<h1>Že by se někdo nemohl dopočítat?</h1><p>Zákazník ${
            req.user.displayName
          } označil fakturu od Vás s datem vytvoření ${moment(
            docs.invoiceDate
          ).format('LLLL')} a celkovou částkou k úhradě ${
            docs.totalCost
          } za nezaplacenou. Nezbývá než čekat, až skutečně zaplatí.</p>`
          sendMail(docs.supplierId.email, subject, body)
          const alert = {
            type: 'success',
            message:
              'Platba byla stornována a faktura byla označena jako neuhrazená.',
            success: 1
          }
          req.session.alert = alert
          res.redirect('/invoices')
        })
        .catch((err) => {
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
