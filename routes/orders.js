var express = require('express');
var router = express.Router();
var moment = require('moment');
var Product = require('../models/product');
var Order = require('../models/order');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

moment.locale('cs');

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

    Order.aggregate([
        { "$match": { 'buyerId': req.user._id} },
        { "$sort": { '_id': -1}},
        { "$lookup": { from: 'products', localField: 'stockId', foreignField: 'stock._id', as: 'productInfo'} },
        { "$lookup": { from: 'invoices', localField: 'invoiceId', foreignField: '_id', as: 'invoiceInfo'} }
    ], function (err, docs) {
        console.log(docs);
        if (req.query.a) {
            var alert = {
                type: req.query.a,
                component: req.query.c,
                message: req.query.m,
                success: req.query.s,
                danger: req.query.d
            };
        }
        docs.forEach(function(element) {
            element.order_date = moment(element.order_date).format('LLLL');
        });
        res.render('shop/orders', { title: 'Objednávky | Lednice IT', orders: docs, user: req.user, alert: alert });
    });
  //res.redirect('/');
});

module.exports = router;
