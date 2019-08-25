var express = require('express');
var router = express.Router();
var Product = require('../models/product');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

    if (!req.user.supplier) {
        res.render('shop/role_missing', {title: 'Nedostatečná oprávnění | Lednice IT', user: req.user });
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
        console.log(docs);
        res.render('shop/supplier_add_products', { title: 'Naskladnit | Lednice IT', products: docs, user: req.user });
    });

});

module.exports = router;
