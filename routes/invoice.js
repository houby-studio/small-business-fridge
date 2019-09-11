// aggregate sketch: orders with deliveries[filtered bu supplier Id] > group by users > craete invoice with total cost and send email > write invoice = true and invoice id to all orders
var express = require('express');
var router = express.Router();
var User = require('../models/user');
var Order = require('../models/order');
var Product = require('../models/product');
var Delivery = require('../models/delivery');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

/* GET about page. */
router.get('/', ensureAuthenticated, function(req, res, next) {

    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }

    // Info view for supplier
    Delivery.aggregate([
        { $match: { 'supplierId': req.user._id } },
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product'} },
        { $unwind: '$product'},
        { $lookup: { from: 'orders', localField: '_id', foreignField: 'deliveryId', as: 'orders' } },
        //{ $unwind: { path: '$bought', preserveNullAndEmptyArrays: true } },
        { $group: {
            _id: '$productId',
            product: { $first: '$product'},
            amount_left: { $sum: '$amount_left' },
            amount_supplied: { $sum: '$amount_supplied' },
            orders_notinvoiced: { $push: { $size: { $filter: {
                input: '$orders',
                as: 'not_invoiced',
                cond: { $eq: ['$$not_invoiced.invoice'] }   
            }}}},
            orders_invoiced: { $push: { $size: { $filter: {
                input: '$orders',
                as: 'invoiced',
                cond: { $eq: ['$$invoiced.invoice'] }
            }}}}
        }},
        /*{ $project: {
            amount_left: 1,
            display_name: '$product.displayName',
            last_Xdays: {
                $size: {
                    $filter: {
                        input: '$bought',
                        as: 'orders',
                        cond: {$gte: ['$$orders.order_date', new Date(new Date() - 14 * 60 * 60 * 24 * 1000)]} // X = 14 days right now
                    }
                }
            }

        }}*/
        //{ $match: { amount_left: { $gt: 0 } } },
    ], function(err, docs) {
        if (err) {
            var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
            req.session.alert = alert;
            res.redirect('/');
            return;
        }
        console.log(docs);
        res.render('shop/invoice', { title: 'Stav skladu | Lednice IT', user: req.user, stock: docs });
    });
});

module.exports = router;