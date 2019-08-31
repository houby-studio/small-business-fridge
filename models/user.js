var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
	oid: {type: String, required: true},
	displayName: {type: String, required: true},
	email: {type: String, required: true},
	keypadId: {type: Number, required: true},
	admin: {type: Boolean, required: true},
	supplier: {type: Boolean, required: true},
	showAllProducts: {type: Boolean, required: true}
});

module.exports = mongoose.model('User', schema);