var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
    buyerId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deliveryId: {
        type: Schema.Types.ObjectId,
        ref: 'Stock',
        required: true
    },
    order_date: {
        type: Date,
        default: Date.now
    },
    invoice: {
        type: Boolean,
        default: false
    },
    invoiceId: {
        type: Schema.Types.ObjectId,
        ref: 'Invoice',
        required: false
    },
    keypadOrder: {
        type: Boolean,
        default: false
    },
});

module.exports = mongoose.model('Order', schema);