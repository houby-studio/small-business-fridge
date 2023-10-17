import { Schema as _Schema, model } from 'mongoose'
var Schema = _Schema

var schema = new Schema({
  supplierId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  productId: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  created_on: {
    type: Date,
    default: Date.now
  },
  amount_supplied: {
    type: Number,
    required: true,
    min: 1
  },
  amount_left: {
    type: Number,
    required: true,
    min: 0
  },
  price: {
    type: Number,
    required: true,
    min: 1
  }
})

export default model('Delivery', schema)
