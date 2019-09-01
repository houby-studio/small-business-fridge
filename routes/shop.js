var express = require('express');
var router = express.Router();
var Product = require('../models/product');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;

/* GET home page. */
router.get('/', ensureAuthenticated, function (req, res) {

  if (req.user.showAllProducts) {
    var filter = {};
  } else {
    var filter = { "stock.amount_left": { "$gt" : 0 }};
  }

  // This crazy query which can be roughly translated for SQL people to "SELECT * FROM Product WHERE Stock.ammount_left > 0"
  Product.aggregate([
    { "$match": filter}, // Depending on user preferences, get either all products or only ones in stock
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
  function(err, docs) { // callback populate Product with results from aggregate
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
    //console.log(req.user); //to see what user object is present
    res.render('shop/shop', { title: 'E-shop | Lednice IT', products: productChunks, user: req.user, alert: alert });
  });
});

module.exports = router;
