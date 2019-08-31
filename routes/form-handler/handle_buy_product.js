var querystring = require('querystring');
var express = require('express');
var router = express.Router();
var ensureAuthenticated = require('../../functions/ensureAuthenticated').ensureAuthenticated;
var Order = require('../../models/order');
var Product = require('../../models/product');

router.post('/', ensureAuthenticated, function (req, res) {

    var newOrder = new Order({
        'buyerId': req.user.id,
        'stockId': req.body.product_id
    });

    //Product.update({ "stock._id": newOrder.stockId },{ "$inc": { "amount_left": -1 } });
    Product.findOne({"stock._id": req.body.product_id}, function(err,obj) {
        if (err) {
            console.log(err);
            var query = querystring.stringify({
                "a": 'danger', "d": 1, "c": 'db', "m": err.message
            });
            res.redirect('/shop?' + query);
            return;
        }
        obj.stock.id(req.body.product_id).amount_left--;
        obj.save();
        newOrder.save(function(err) {
            if (err) {
                console.log(err);
                var query = querystring.stringify({
                    "a": 'danger', "d": 1, "c": 'db', "m": err.message
                });
                res.redirect('/shop?' + query);
                return;
            } else {
                var query = querystring.stringify({
                    "a": 'success', "s": 1, "m": `Zakoupili jste ${req.body.display_name} za ${req.body.product_price}Kč.`
                });
                res.redirect('/shop?' + query);
                return;
            }
        });
    });

    /*Product.update({ "stock._id": req.body.product_id }, {"amount_left": { "$inc": -1 } }, function(err,obj) {
        if (err) {
            console.log(err);
        }
        console.log('updatovano', obj);
    });*/
    
});

module.exports = router;
