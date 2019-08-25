var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Stock = new Schema({
	supplierId: {type: Schema.Types.ObjectId, ref: 'User', required: true},
	created_on: {type: Date, required: true},
	ammount_supplied: {type: Number, required: true},
	ammount_left: {type: Number, required: true},
	price: {type: Number, required: true}
});

var schema = new Schema({
	keypadId: {type: Number, required: false},
	displayName: {type: String, required: true},
	description: {type: String, required: true},
	imagePath: {type: String, required: true},
	stock: [Stock]
});

module.exports = mongoose.model('Product', schema);