// aggregate sketch: orders with deliveries[filtered bu supplier Id] > group by users > craete invoice with total cost and send email > write invoice = true and invoice id to all orders
var express = require('express');
var router = express.Router();
var palette = require('google-palette'); // works like this?
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
            root: { $push: '$$ROOT'}
        }},
        { $group: {
            _id: null,
            stock: { $push: '$$ROOT'},
            total_num_orders_invoiced: { $sum: '$num_orders_invoiced'},
            total_num_orders_notinvoiced: { $sum: '$num_orders_notinvoiced'},
            total_sum_orders_invoiced: { $sum: '$sum_orders_invoiced'},
            total_sum_orders_notinvoiced: { $sum: '$sum_orders_notinvoiced'},
            total_num_stocked: { $sum: '$amount_left'},
            total_sum_stocked: { $sum: '$sum_stocked'},
            /*total_sum_orders_invoiced: 1,
            total_sum_orders_notinvoiced: 1,
            total_sum_cash_stocked: 1,*/
        }},
        //{ $unwind: '$stock' }
        /*{ $project: {
            amount_left: 1,
            display_name: '$product.displayName',
            num_orders_invoiced: 1,
            num_orders_notinvoiced: 1,
            sum_orders_invoiced: 1,
            sum_orders_notinvoiced: 1,
            sum_cash_stocked: 1,
            total_num_orders_invoiced: { $sum: '$num_orders_invoiced'},
            total_num_orders_notinvoiced: { $sum: '$num_orders_notinvoiced'},
            total_sum_orders_invoiced: 1,
            total_sum_orders_notinvoiced: 1,
            total_sum_cash_stocked: 1,
        }}*/
    ], function(err, docs) {
        if (err) {
            var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
            req.session.alert = alert;
            res.redirect('/');
            return;
        }
        console.log(docs[0]);
        res.render('shop/invoice', { title: 'Stav skladu | Lednice IT', user: req.user, stock: docs[0] });
    });
});

router.post('/', ensureAuthenticated, function(req, res, next) {

    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }

    Delivery.aggregate([
        { $match: { 'supplierId': req.user._id } },
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
            //product: { $first: '$product'},
            //root: { $push: '$$ROOT'}
        }},
        { $project: {
            user: 1,
            orders: 1,
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
        res.render('shop/invoice', { title: 'Stav skladu | Lednice IT', user: req.user, stock: docs });
    });
});

module.exports = router;