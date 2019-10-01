var express = require('express');
var router = express.Router();
var palette = require('google-palette');
var moment = require('moment');
moment.locale('cs');
var mailer = require('../functions/sendMail');
var qrPayment = require('../functions/qrPayment');
var Delivery = require('../models/delivery');
var Order = require('../models/order');
var Invoice = require('../models/invoice');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

// GET supplier invoice page.
router.get('/', ensureAuthenticated, function(req, res, next) {

    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }

    if (req.baseUrl === '/admin_invoice') {
        if (!req.user.admin) {
            res.redirect('/');
            return;
        }
        var filter = {};
    } else {
        var filter = { 'supplierId': req.user._id };
    }

    // Aggregate and group by productId for product based info - total amounts and total price for 'invoiced', 'not invoiced' and 'on stock'
    Delivery.aggregate([
        { $match: filter }, // Get only deliveries inserted by supplier requesting the page
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product'} }, // join on product
        { $unwind: '$product'},
        { $lookup: { from: 'orders', localField: '_id', foreignField: 'deliveryId', as: 'orders' } }, // join on orders
        { $group: {
            _id: '$productId', // group by Product Id
            product: { $first: '$product'},
            amount_left: { $sum: '$amount_left' },
            amount_supplied: { $sum: '$amount_supplied' },
            orders: { $push: '$orders' },
            num_orders_notinvoiced: { $sum: { $size: { $filter: { 
                input: '$orders',
                as: 'notinvoiced',
                cond: { $eq: ['$$notinvoiced.invoice', false] }
            }}}},
            num_orders_invoiced: { $sum: { $size: { $filter: { 
                input: '$orders',
                as: 'invoiced',
                cond: { $eq: ['$$invoiced.invoice', true] }
            }}}},
            sum_orders_notinvoiced: { $sum: { $sum: { $map: {
                input: { 
                    $filter: {
                        input: '$orders',
                        as: 'notinvoiced',
                        cond: { $eq: ['$$notinvoiced.invoice', false] }
                    }
                },
                as: 'total',
                in: '$price',
            }}}},
            sum_orders_invoiced: { $sum: { $sum: { $map: {
                input: { 
                    $filter: {
                        input: '$orders',
                        as: 'invoiced',
                        cond: { $eq: ['$$invoiced.invoice', true] }
                    }
                },
                as: 'total',
                in: '$price',
            }}}},
            sum_stocked: { $sum: { $multiply: [ '$price', '$amount_left' ] }},
        }},
        { $group: {
            _id: null, // group all to get some total values across all products
            stock: { $push: '$$ROOT'},
            total_num_orders_invoiced: { $sum: '$num_orders_invoiced'},
            total_num_orders_notinvoiced: { $sum: '$num_orders_notinvoiced'},
            total_sum_orders_invoiced: { $sum: '$sum_orders_invoiced'},
            total_sum_orders_notinvoiced: { $sum: '$sum_orders_notinvoiced'},
            total_num_stocked: { $sum: '$amount_left'},
            total_sum_stocked: { $sum: '$sum_stocked'},
        }}
    ], function(err, docs) {
        if (err) {
            var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
            req.session.alert = alert;
            res.redirect('/');
            return;
        }

        // Aggregate and group by user for user based info - total amounts and total price 'not invoiced' and all not invoiced orders
        Delivery.aggregate([
            { $match: filter },
            { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product'} },
            { $unwind: '$product'},
            { $lookup: { from: 'orders', localField: '_id', foreignField: 'deliveryId', as: 'orders' } },
            { $unwind: { path: '$orders', preserveNullAndEmptyArrays: true } },
            { $addFields: { 'orders.product': '$product'} },
            { $addFields: { 'orders.price': '$price'} },
            { $match: { 'orders.invoice': false } },
            { $lookup: { from: 'users', localField: 'orders.buyerId', foreignField: '_id', as: 'user' } },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            { $group: {
                _id: '$orders.buyerId',
                user: { $first: '$user' },
                orders: { $push: '$orders' },
            }},
            { $project: {
                user: '$user.displayName',
                'orders.product.displayName': 1,
                'orders.order_date': 1,
                'orders.price': 1,
                total_user_num_orders_notinvoiced: { $size: '$orders'},
                total_user_sum_orders_notinvoiced: { $sum: '$orders.price' },
            }}
        ], function(err, udocs) {
            if (err) {
                var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
                req.session.alert = alert;
                res.redirect('/');
                return;
            }
            if (docs[0]) {
                var graphColors = palette('mpn65', docs[0].stock.length);
                for (var i = 0; i < docs[0].stock.length; i++) {
                    docs[0].stock[i].color = graphColors[i];
                }
            }
            if (udocs[0]) {
                var graphColors = palette('mpn65', udocs.length);
                for (var i = 0; i < udocs.length; i++) {
                    udocs[i].color = graphColors[i];
                    udocs[i].orders.forEach(function(element) {
                        element.order_date_format = moment(element.order_date).format('LLLL');
                        element.order_date = moment(element.order_date).format();
                    });
                }
            }

            if (req.session.alert) {
                var alert = req.session.alert;
                delete req.session.alert;
            }
            res.render('shop/invoice', { title: 'Fakturace | Lednice IT', user: req.user, productview: docs[0], userview: udocs, supplier: filter, alert: alert });
        });
    });
});

router.post('/', ensureAuthenticated, function(req, res, next) {

    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }

    // Aggregate and group by user to create invoice for each of them
    Delivery.aggregate([
        { $match: { 'supplierId': req.user._id }},
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product'} },
        { $unwind: '$product'},
        { $lookup: { from: 'orders', localField: '_id', foreignField: 'deliveryId', as: 'orders' } },
        { $unwind: { path: '$orders', preserveNullAndEmptyArrays: true } },
        { $addFields: { 'orders.product': '$product'} },
        { $addFields: { 'orders.price': '$price'} },
        { $match: { 'orders.invoice': false } },
        // { $set: { 'orders.invoice': true } }, // In the future could be easier on Mongo 4.2 with this new feature
        { $lookup: { from: 'users', localField: 'orders.buyerId', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $group: {
            _id: '$orders.buyerId',
            user: { $first: '$user' },
            orders: { $push: '$orders' },
        }},
        { $project: {
            'orders._id': 1,
            'orders.product.displayName': 1,
            'orders.order_date': 1,
            'orders.price': 1,
            user: 1,
            total_user_num_orders_notinvoiced: { $size: '$orders'},
            total_user_sum_orders_notinvoiced: { $sum: '$orders.price' },
        }}
    ], function(err, docs) {
        if (err) {
            var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
            req.session.alert = alert;
            res.redirect('/');
            return;
        }
        console.log(docs);

        // Loop through array for each user
        for (let i = 0; i < docs.length; i++) {
            // Create new invoice to be sent to user
            var newInvoice = new Invoice({
                'buyerId': docs[i].user._id,
                'supplierId': req.user.id,
                'totalCost': docs[i].total_user_sum_orders_notinvoiced
            });
            var bulk = Order.collection.initializeUnorderedBulkOp();
            // Loop through array for each order for that user
            for (let p = 0; p < docs[i].orders.length; p++) {
                newInvoice.ordersId.push(docs[i].orders[p]._id);
                bulk.find( { _id: docs[i].orders[p]._id } ).updateOne( { $set: { invoice: true } } );
            }
            // bulk.find( {} ).update( { $set: { invoice: false } } ); // for test purposes only
            bulk.execute(function (err, items) {
                newInvoice.save();
                // Send e-mail
                qrPayment(req.user.IBAN, docs[i].total_user_sum_orders_notinvoiced, moment().format('YYYYMMDD'), docs[i].user.displayName, req.user.displayName, function (qrcode) {
                    var subject = `Fakturace!`;
                    var body = `<h1>Přišel čas zúčtování!</h1><p>Velký a mocný dodavatel ${req.user.displayName} Vám zaslal fakturu.</p><h2>Fakturační údaje</h2><p>Částka k úhradě: ${docs[i].total_user_sum_orders_notinvoiced}Kč<br>Počet zakoupených produktů: ${docs[i].total_user_num_orders_notinvoiced}ks<br>Datum fakturace: ${moment().format('LLLL')}<br><a href="https://lednice.prdelka.eu/invoices">Více na webu Lednice IT</a></p><p>Platbu je možné provést hotově nebo převodem.<br>Po platbě si zkontrolujte, zda dodavatel označil Vaši platbu jako zaplacenou.</p>`;
                    if (req.user.IBAN) {
                        body += `<h2>QR platba</h2><img width="480" height="480" style="width: 20rem; height: 20rem;" alt="QR kód pro mobilní platbu se Vám nezobrazuje správně." src="${qrcode}"/><p>IBAN: ${req.user.IBAN}</p><p>Předem díky za včasnou platbu!</p>`;
                    };
                    mailer.sendMail(req.user.email, subject, body);
                });
            });
        }
        var alert = { type: 'success', message: 'Fakturace úspěšně vygenerována!', success: 1};
        req.session.alert = alert;
        res.redirect('/invoice');
        return;
    });
});

module.exports = router;