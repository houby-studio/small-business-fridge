var express = require('express');
var config = require('../config/config.js'); // configuration file
var router = express.Router();
var palette = require('google-palette');
var moment = require('moment');
moment.locale('cs');
var mailer = require('../functions/sendMail');
var qrPayment = require('../functions/qrPayment');
var Delivery = require('../models/delivery');

var Invoice = require('../models/invoice');
var ensureAuthenticated = require('../functions/ensureAuthenticated').ensureAuthenticated;
var mongoose = require('mongoose'); // database
mongoose.set('useNewUrlParser', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);
mongoose.set('useUnifiedTopology', true);
mongoose.connect(config.config.db.connstr,{ useNewUrlParser: true });
var Order = require('../models/order');


for (i=0; i<10000; i++) {console.log("something");}
    var bulk = Order.collection.initializeUnorderedBulkOp();
bulk.find( { invoice: true } ).update( { $set: { invoice: false } } );
bulk.execute(function (err, items) {
    if (err) {
        console.log("Something went wrong");
        console.log(err);
    }
});