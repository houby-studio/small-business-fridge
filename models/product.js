var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Stock = new Schema({
	supplierId: {type: Schema.Types.ObjectId, ref: 'User', required: true},
	created_on: {type: Date, default: Date.now},
	amount_supplied: {type: Number, required: true, min: 1},
	amount_left: {type: Number, required: true, min: 0},
	price: {type: Number, required: true, min: 1}
});

var schema = new Schema({
	keypadId: {type: Number, required: false, min: 0},
	displayName: {type: String, required: true},
	description: {type: String, required: true},
	imagePath: {type: String, required: true},
	stock: [Stock]
});

module.exports = mongoose.model('Product', schema);