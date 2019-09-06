var querystring = require('querystring');
var express = require('express');
var router = express.Router();
var ensureAuthenticated = require('../../functions/ensureAuthenticated').ensureAuthenticated;
var Product = require('../../models/product');
var Delivery = require('../../models/delivery');
var csrf = require('csurf');
var csrfProtection = csrf();
router.use(csrfProtection);

router.post('/', ensureAuthenticated, function (req, res) {

    if (!req.user.supplier) {
        res.redirect('/');
        return;
    }
    Product.findById(req.body.product_id, function (err, prod) {
        if (err) {
            var query = querystring.stringify({
                "response": 'error', "module": 'db', "code": 400
            });
            res.redirect('/add_products?' + query);
            return;
        }
        var newDelivery = new Delivery({
            'supplierId': req.user.id,
            'productId': req.body.product_id,
            'amount_supplied': req.body.product_amount,
            'amount_left': req.body.product_amount,
            'price': req.body.product_price,
        });

        newDelivery.save(function (err) {
            if (err) {
                console.log(err);
                var query = querystring.stringify({
                    "a": 'danger', "d": 1, "c": 'db', "m": err.message
                });
                res.redirect('/add_products?' + query);
                return;
            }
            var query = querystring.stringify({
                "a": 'success', "s": 1, "m": `${prod.displayName} přidán v počtu ${req.body.product_amount}ks za ${req.body.product_price}Kč.`
            });
            res.redirect('/add_products?' + query);
            return;
        });
    });
});

module.exports = router;
