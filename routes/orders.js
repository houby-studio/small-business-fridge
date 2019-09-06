var express = require('express');
var router = express.Router();
var moment = require('moment');
var Mongoose = require('mongoose');
var ObjectId = Mongoose.Types.ObjectId;
var Product = require('../models/product');
var Order = require('../models/order');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

moment.locale('cs');

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

    Order.aggregate([
        { $match: { 'buyerId': req.user._id} },
        { $sort: { '_id': -1 } },
        { $lookup: { from: 'deliveries', localField: 'deliveryId', foreignField: '_id', as: 'deliveryInfo'} },
        { $unwind: '$deliveryInfo'},
        { $lookup: { from: 'users', localField: 'deliveryInfo.supplierId', foreignField: '_id', as: 'supplierInfo'} },
        { $unwind: '$supplierInfo'},
        { $lookup: { from: 'products', localField: 'deliveryInfo.productId', foreignField: '_id', as: 'productInfo'} },
        { $unwind: '$productInfo'},
        { $group: {
            _id: null,
            totalOrders: { $sum: 1},
            totalSpend: { $sum: '$deliveryInfo.price'},
            results: { $push: '$$ROOT'}
        }},
        { $project: {
            totalOrders: 1,
            totalSpend: 1,
            results: 1,
            totalUnpaid: {
                $let: {
                    vars: {
                           'field': {
                               $filter: {
                                      input: "$results",
                                      as: "calc",
                                      cond: { $eq: ['$$calc.invoice', false ] }
                              }}  
                      },
                      in: { $sum: "$$field.deliveryInfo.price" }
                  }
            },
        }}
        /*{ $project: { not sure yet if I want to calculate fields in query or in javascript later
            order_date: 1,
            'deliveryInfo.price': 1,
            'productInfo.displayName': 1,
            'supplierInfo.displayName': 1,
            invoice: 1,
            totalPaid: 1
        }}*/
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
        if (docs[0]) {
            docs[0].results.forEach(function(element) {
                element.order_date = moment(element.order_date).format('LLLL');
            });
        }

        res.render('shop/orders', { title: 'Objednávky | Lednice IT', orders: docs[0], user: req.user, alert: alert });
    });
  //res.redirect('/');
});

module.exports = router;
