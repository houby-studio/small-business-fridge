var querystring = require('querystring');
var express = require('express');
var router = express.Router();
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;
var Product = require('../models/product');
var Delivery = require('../models/delivery');
var csrf = require('csurf');
var csrfProtection = csrf();
router.use(csrfProtection);

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }

    Product.find(function(err, docs) {
        if (err) {
            res.status(err.status || 500);
            res.render('error');
        }
        // docs.stringify = JSON.stringify(docs); // Stringify whole object to pass it to client
        docs.client_data = JSON.stringify ({
            'product_id': docs.map(a => a.id, b => b.imagePath),
            'product_image': docs.map(a => a.imagePath)
        });
        // GET parameters
        if (req.query.a) {
            var alert = {
                type: req.query.a,
                component: req.query.c,
                message: req.query.m,
                success: req.query.s,
                danger: req.query.d
            };
        }
        console.log(docs);
        res.render('shop/supplier_add_products', { title: 'Naskladnit | Lednice IT', products: docs, user: req.user, alert: alert, csrfToken: req.csrfToken() });
    });

});

module.exports = router;
