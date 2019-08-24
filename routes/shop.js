var express = require('express');
var router = express.Router();
var Product = require('../models/product');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

  Product.find(function(err, docs) {
    if (err) {
      res.status(err.status || 500);
      res.render('error');
    }
    var productChunks = [];
    var chunkSize = 4;
    for (var i = 0; i < docs.length; i += chunkSize) {
      productChunks.push(docs.slice(i, i + chunkSize));
    }
      //console.log(req.user); to see what user object is present
      res.render('shop/shop', { title: 'E-shop | Lednice IT', products: productChunks, user: req.user });
  });

});

module.exports = router;
