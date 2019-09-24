var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
    buyerId: {type: Schema.Types.ObjectId, ref: 'User', required: true},
    supplierId: {type: Schema.Types.ObjectId, ref: 'User', required: true},
    ordersId: [{type: Schema.Types.ObjectId, ref: 'Order'}],
    invoiceDate: {type: Date, default: Date.now},
    paid: {type: Boolean, default: false},
    requestPaid: {type: Boolean, default: false},   
});

module.exports = mongoose.model('Invoice', schema);