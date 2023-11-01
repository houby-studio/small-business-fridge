import { Schema as _Schema, model } from 'mongoose'
var Schema = _Schema

var schema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  color: {
    type: String,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

export default model('Category', schema)
