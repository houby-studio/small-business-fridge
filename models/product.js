var mongoose = require('mongoose')
var Schema = mongoose.Schema
var uniqueValidator = require('mongoose-unique-validator')

var schema = new Schema({
  keypadId: {
    type: Number,
    required: false,
    unique: true,
    min: 0
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  imagePath: {
    type: String,
    required: true
  }
})

schema.plugin(uniqueValidator)

module.exports = mongoose.model('Product', schema)
