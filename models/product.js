var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
	keypadId: {type: Number, required: true},
	uniqueName: {type: String, required: true},
	displayName: {type: String, required: true},
	description: {type: String, required: true},
	imagePath: {type: String, required: true},
	price: {type: Number, required: true}
});

module.exports = mongoose.model('Product', schema);