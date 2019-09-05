var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var schema = new Schema({
	oid: {type: String, required: true},
	displayName: {type: String, required: true},
	email: {type: String, required: true},
	keypadId: {type: Number, required: true},
	admin: {type: Boolean, default: false},
	supplier: {type: Boolean, default: false},
	showAllProducts: {type: Boolean, default: false}
});

module.exports = mongoose.model('User', schema);