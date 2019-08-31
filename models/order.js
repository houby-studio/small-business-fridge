var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
    buyerId: {type: Schema.Types.ObjectId, ref: 'User', required: true},
    stockId: {type: Schema.Types.ObjectId, ref: 'Product.Stock', required: true},
    order_date: {type: Date, default: Date.now},
    invoice: {type: Boolean, default: false},
    invoiceId: {type: Schema.Types.ObjectId, ref: 'Invoice', required: false},
    //paid: {type: Boolean, default: false}
});

module.exports = mongoose.model('Order', schema);