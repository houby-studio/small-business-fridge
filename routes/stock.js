var express = require('express');
var router = express.Router();
var Delivery = require('../models/delivery');

/* GET about page. */
router.get('/', function(req, res, next) {

    Delivery.aggregate([
        { $match: { 'supplierId': req.user._id } },
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product'} },
        { $unwind: '$product'},
        { $lookup: { from: 'orders', localField: '_id', foreignField: 'deliveryId', as: 'bought' } },
        //{ $unwind: { path: '$bought', preserveNullAndEmptyArrays: true } },
        { $group: {
            _id: '$productId',
            product: { $first: '$product'},
            amount_left: { $sum: '$amount_left' },
            //amount_supplied: { $sum: '$amount_supplied' },
            bought: { $push: { $size: { $filter: {
                input: '$bought',
                as: 'orders',
                cond: {$gte: ['$$orders.order_date', new Date(new Date() - 14 * 60 * 60 * 24 * 1000)]} // X = 14 days right now
            }}}}
        }},
        { $project: {
            amount_left: 1,
            display_name: '$product.displayName',
            last_Xdays: { $sum: '$bought' }

        }}
    ], function(err, docs) {
        if (err) {
            console.log(err);
            var alert = { type: 'danger', component: 'db', message: err.message, danger: 1};
            req.session.alert = alert;
            res.redirect('/');
            return;
        }
        console.log(docs);
        res.render('shop/stock', { title: 'Stav skladu | Lednice IT', user: req.user, stock: docs });
    });
});

module.exports = router;