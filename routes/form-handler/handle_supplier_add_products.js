var querystring = require('querystring');
var express = require('express');
var router = express.Router();
var ensureAuthenticated = require('../../functions/ensureAuthenticated').ensureAuthenticated;
var Product = require('../../models/product');

router.post('/', ensureAuthenticated, function (req, res) {

    if (!req.user.supplier) {
        res.render('shop/role_missing', {title: 'Nedostatečná oprávnění | Lednice IT', user: req.user });
    }
    Product.findById(req.body.product_id, function (err, prod) {
        if (err) {
            var query = querystring.stringify({
                "response": 'error', "module": 'db', "code": 400
            });
            res.redirect('/add_products?' + query);
            return;
        }
        console.log(req.body);
        console.log(req.user);
        prod.stock.push({supplierId: req.user.id, ammount_supplied: req.body.product_ammount, ammount_left: req.body.product_ammount, price: req.body.product_price });
        prod.save(function (err) {
            if (err) {
                console.log(err);
                var query = querystring.stringify({
                    "response": 'error', "module": 'db', "code": 401, "error": err.message
                });
                res.redirect('/add_products?' + query);
                return;
            }
            var query = querystring.stringify({
                "response": 'success', "code": 200
            });
            res.redirect('/add_products?' + query);
            return;
        });
    });
});

module.exports = router;
