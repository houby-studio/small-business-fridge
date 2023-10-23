import { Schema as _Schema, model } from 'mongoose'
var Schema = _Schema
import uniqueValidator from 'mongoose-unique-validator'

var schema = new Schema({
  keypadId: {
    type: Number,
    required: true,
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

export default model('Product', schema)
