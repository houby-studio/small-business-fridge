var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
	keypadId: {type: Number, required: false, min: 0},
	displayName: {type: String, required: true},
	description: {type: String, required: true},
	imagePath: {type: String, required: true}
});

module.exports = mongoose.model('Product', schema);