var express = require('express');
var router = express.Router();
var User = require('../models/user');
var Order = require('../models/order');
var Product = require('../models/product');
var Delivery = require('../models/delivery');

/* GET about page. */
router.get('/', function(req, res, next) {

    Delivery.aggregate([
        { $match: { 'supplierId': req.user._id } },
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product'} },
        { $unwind: '$product'},
        { $lookup: { from: 'orders', localField: '_id', foreignField: 'deliveryId', as: 'bought' } },
        { $unwind: { path: '$bought', preserveNullAndEmptyArrays: true } },
        { $group: {
            _id: '$productId',
            product: { $first: '$product'},
            amount_left: { $sum: '$amount_left' },
            //amount_supplied: { $sum: '$amount_supplied' },
            bought: { $push: '$bought' }
        }},
        { $project: {
            amount_left: 1,
            displayName: '$product.displayName',
            last_week: {
                $filter: {
                    input: '$bought',
                    as: 'orders',
                    cond: {$gte: ['$$orders.order_date', new Date(new Date() - 7 * 60 * 60 * 24 * 1000)]}
                }
            }

        }}
        //{ $match: { amount_left: { $gt: 0 } } },
    ], function(err, docs) {
        console.log(docs);
        res.render('shop/stock', { title: 'Stav skladu | Lednice IT', user: req.user, stock: docs });
    });
});

module.exports = router;