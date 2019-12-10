var express = require('express')
var router = express.Router()
var moment = require('moment')
moment.locale('cs')
var mailer = require('../functions/sendMail')
var Invoice = require('../models/invoice')
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated
var csrf = require('csurf')
var csrfProtection = csrf()
router.use(csrfProtection)

// GET invoices page.
router.get('/', ensureAuthenticated, function (req, res, _next) {
  var filter = {
    buyerId: req.user._id
  }

  // Aggregate invoices, lookup supplier display name and sum number of orders in invoice
  Invoice.aggregate([{
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
  ], function (err, docs) {
    var alert
    if (err) {
      alert = {
        type: 'danger',
        component: 'db',
        message: err.message,
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/')
      return
    }

    if (docs) {
      docs.forEach(function (element) {
        element.invoiceDate_format = moment(element.invoiceDate).format('LLLL')
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
})

// Form post - Handles Invoice "requestPaid" status changes
router.post('/', ensureAuthenticated, function (req, res, _next) {
  // Check if customer changes invoice which belongs to him
  Invoice.findById(req.body.invoice_id, function (_err, check) {
    if (!check.buyerId.equals(req.user.id)) {
      var alert
      var subject = 'Neoprávněná akce?!'
      var body = `<h1>Jak se toto podařilo?!</h1><p>Zákazník ${req.body.displayName} se pokouší manipulovat s fakturou ID ${check._id}, přestože ji nevlastní.</p>Jeho akce byla revertována. Prověřte celou situaci!</p>`
      mailer.sendMail('system', subject, body)
      alert = {
        type: 'danger',
        message: 'Nemáte oprávnění měnit status faktury, která Vám nepatří!',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/invoices')
      return
    }
    if (check.paid === true) {
      alert = {
        type: 'danger',
        message: 'Faktura již byla označena dodavatelem jako uhrazená, není nutné ji tedy označovat z Vaší strany.',
        danger: 1
      }
      req.session.alert = alert
      res.redirect('/invoices')
      return
    }

    if (req.body.action === 'paid') {
      // Handles status change to 'requestPaid: true'
      Invoice.findByIdAndUpdate(req.body.invoice_id, {
        requestPaid: true
      }, {
        upsert: true
      }).populate('supplierId').exec(function (err, docs) {
        var alert
        if (err) {
          alert = {
            type: 'danger',
            component: 'db',
            message: err.message,
            danger: 1
          }
          req.session.alert = alert
          res.redirect('/invoices')
          return
        }
        var subject = `Zákazník ${req.user.displayName} uhradil fakturu!`
        var body = `<h1>Penízky už se sypou!</h1><p>Zákazník ${req.user.displayName} označil fakturu od Vás s datem vytvoření ${moment(docs.invoiceDate).format('LLLL')} a celkovou částkou k úhradě ${docs.totalCost} za zaplacenou.</p><p>Zkontrolujte zda se tak stalo a následně potvrďte na webu přes tento odkaz</p>`
        mailer.sendMail(docs.supplierId.email, subject, body)
        alert = {
          type: 'success',
          message: 'Faktura byla označena jako uhrazená u dodavatele. Vyčkejte na schválení.',
          success: 1
        }
        req.session.alert = alert
        res.redirect('/invoices')
      })
    } else if (req.body.action === 'storno') {
      // Handles status change to 'requestPaid: false'
      Invoice.findByIdAndUpdate(req.body.invoice_id, {
        requestPaid: false
      }, {
        upsert: true
      }).populate('supplierId').exec(function (err, docs) {
        var alert
        if (err) {
          alert = {
            type: 'danger',
            component: 'db',
            message: err.message,
            danger: 1
          }
          req.session.alert = alert
          res.redirect('/invoices')
          return
        }
        var subject = `Zákazník ${req.user.displayName} stornoval platbu faktury!`
        var body = `<h1>Že by se někdo nemohl dopočítat?</h1><p>Zákazník ${req.user.displayName} označil fakturu od Vás s datem vytvoření ${moment(docs.invoiceDate).format('LLLL')} a celkovou částkou k úhradě ${docs.totalCost} za nezaplacenou. Nezbývá než čekat, až skutečně zaplatí.</p>`
        mailer.sendMail(docs.supplierId.email, subject, body)
        alert = {
          type: 'success',
          message: 'Platba byla stornována a faktura byla označena jako neuhrazená.',
          success: 1
        }
        req.session.alert = alert
        res.redirect('/invoices')
      })
    } else {
      alert = {
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

module.exports = router
