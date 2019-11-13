var express = require('express');
var router = express.Router();
var moment = require('moment');
moment.locale('cs');
var mailer = require('../functions/sendMail');
var Invoice = require('../models/invoice');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;
var csrf = require('csurf');
var csrfProtection = csrf();
router.use(csrfProtection);

// GET supplier payments page.
router.get('/', ensureAuthenticated, function(req, res, next) {

    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }

    if (req.baseUrl === '/admin_payments') {
        if (!req.user.admin) {
            res.redirect('/');
            return;
        }
        var filter = {};
    } else {
        var filter = { 'supplierId': req.user._id };
    }

    // Aggregate invoices, lookup buyer display name and sum number of orders in invoice
    Invoice.aggregate([
        { $match: filter }, // Get only deliveries inserted by supplier requesting the page
        { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer'} }, // join on product
        { $unwind: '$buyer'},
        { $project: {
            _id: 1,
            'buyer.displayName': 1,
            'buyer.email': 1,
            paid: 1,
            requestPaid: 1,
            totalCost: 1,
            invoiceDate: 1,
            orders_sum: { $size: '$ordersId'}
        }}
    ], function(err, docs) {
        if (err) {
            var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
            req.session.alert = alert;
            res.redirect('/');
            return;
        }

        if (docs) {
            docs.forEach(function(element) {
                element.invoiceDate_format = moment(element.invoiceDate).format('LLLL');
                element.invoiceDate = moment(element.invoiceDate).format();
                if (element.paid) {
                    element.status = 'Uhrazeno';
                } else if (element.requestPaid) {
                    element.status = 'Čeká na potvrzení';
                } else {
                    element.status = 'Neuhrazeno';
                }
            });
        }

        if (req.session.alert) {
            var alert = req.session.alert;
            delete req.session.alert;
        }
        res.render('shop/payments', { title: 'Platby | Lednice IT', user: req.user, invoices: docs, supplier: filter, alert: alert, csrfToken: req.csrfToken() });
    });
});

// Form post - Handles Invoice "paid" status changes
router.post('/', ensureAuthenticated, function(req, res, next) {
    
    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }

    // Check if supplier changes invoice he owns
    Invoice.findById(req.body.invoice_id, function (err, check) {
        if (check.supplierId != req.user.id) {
            var subject = `Neoprávněná akce?!`;
            var body = `<h1>Jak se toto podařilo?!</h1><p>Dodavatel ${req.body.displayName} se pokouší manipulovat s fakturou ID ${check._id}, přestože ji nevytvořil.</p>Jeho akce byla revertována. Prověřte celou situaci!</p>`;
            mailer.sendMail('system', subject, body);
            var alert = { type: 'danger', message: `Nemáte oprávnění měnit status faktury, kterou jste nevytvořil!`, danger: 1};
            req.session.alert = alert;
            res.redirect('/payments');
            return;
        }

        if (req.body.action == 'approve') {
            // Handles status change to 'paid: true'
            Invoice.findByIdAndUpdate(req.body.invoice_id, { paid: true }, { upsert: true }).populate('buyerId').exec(function (err, docs) {
                if (err) {
                    var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
                    req.session.alert = alert;
                    res.redirect('/payments');
                    return;
                }
                var subject = `Vaše platba byla potvrzena!`;
                var body = `<h1>Obchod byl dokončen!</h1><p>Váš dodavatel ${req.user.displayName} potvrdil, že jste fakturu uhradil!</p><p>Podrobnosti k faktuře:<br>Datum fakturace: ${moment(docs.invoiceDate).format('LLLL')}<br>Celková částka k úhradě: ${docs.totalCost}Kč</p>`;
                mailer.sendMail(docs.buyerId.email, subject, body);
                var alert = { type: 'success', message: `Faktura byla označena jako uhrazená.`, success: 1};
                req.session.alert = alert;
                res.redirect('/payments');
                return;
            });
        } else if (req.body.action == 'storno') {
            // Handles status change to 'paid: false'
            Invoice.findByIdAndUpdate(req.body.invoice_id, { paid: false }, { upsert: true }).populate('buyerId').exec(function (err, docs) {
                if (err) {
                    var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
                    req.session.alert = alert;
                    res.redirect('/payments');
                    return;
                }
                var subject = `Vaše platba byla stornována!`;
                var body = `<h1>Jak je toto možné?</h1><p>Váš dodavatel ${req.user.displayName} označil Vaši fakturu s datem vytvoření ${moment(docs.invoiceDate).format('LLLL')} a celkovou částkou k úhradě ${docs.totalCost}Kč za nezaplacenou. Vyřiďte si s ním kde nastala chyba.</p>`;
                mailer.sendMail(docs.buyerId.email, subject, body);
                var alert = { type: 'success', message: `Platba byla stornována a faktura byla označena jako neuhrazená.`, success: 1};
                req.session.alert = alert;
                res.redirect('/payments');
                return;
            });
        } else {
            var alert = { type: 'danger', component: 'web', message: 'Při zpracování došlo k chybě. Požadovaná akce neexistuje!', danger: 1};
            req.session.alert = alert;
            res.redirect('/payments');
            return;
        }
    });
});

module.exports = router;