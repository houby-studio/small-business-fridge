var express = require('express');
var router = express.Router();
var Product = require('../models/product');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

  // This crazy query which can be roughly translated for SQL people to "SELECT * FROM Product WHERE Stock.ammount_left > 0"
  Product.aggregate([
    //{ "$match": { "stock.amount_left": { "$gt" : 0 } } }, // if we want to display only products which match only if any stock ammount left is greater than 0
    { "$project": { // Since aggregate doesn't return resulting object, but plain value, we have to project it to cast its content back to object
      "keypadId": "$keypadId",
      "displayName": "$displayName",
      "description": "$description",
      "imagePath": "$imagePath",
      "stock": {"$filter": { // We filter only the stock object from array where ammount left is greater than 0
          "input": '$stock',
          "as": 'stock',
          "cond": { "$gt": ['$$stock.amount_left', 0]}
      }}
    }}
  ],
  function(err, products) { // callback populate Product with results from aggregate
    console.log(products);
    Product.populate(
      products.map(function(product) {return new Product(product) }), // Don't know exactly what map does
      {
        "path": "stock.Stock",
        "match": { "amount_left": { "$gt": 0 } }
      },
      function(err, docs) {
        if (err) {
          res.status(err.status || 500);
          res.render('error');
        }
        //console.log(docs);
        var productChunks = [];
        var chunkSize = 4;
        for (var i = 0; i < docs.length; i += chunkSize) {
          productChunks.push(docs.slice(i, i + chunkSize));
        }
        //console.log(req.user); to see what user object is present
        res.render('shop/shop', { title: 'E-shop | Lednice IT', products: productChunks, user: req.user });
      }
    );
  });

  /* Product.find(function(err, docs) {
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
  }); */

});

module.exports = router;
