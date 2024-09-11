import { Schema, model } from 'mongoose'

const schema = new Schema({
  supplierId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true
  },
  productId: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    index: true,
    required: true
  },
  created_on: {
    type: Date,
    default: Date.now,
    index: true
  },
  amount_supplied: {
    type: Number,
    required: true,
    min: 1
  },
  amount_left: {
    type: Number,
    required: true,
    min: 0,
    index: true
  },
  price: {
    type: Number,
    required: true,
    min: 1
  }
})

export default model('Delivery', schema)
