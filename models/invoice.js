import { Schema, model } from 'mongoose'

const schema = new Schema({
  buyerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  supplierId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  ordersId: [
    {
      type: Schema.Types.ObjectId,
      ref: 'Order'
    }
  ],
  totalCost: {
    type: Number,
    required: true
  },
  invoiceDate: {
    type: Date,
    default: Date.now
  },
  paid: {
    type: Boolean,
    default: false
  },
  requestPaid: {
    type: Boolean,
    default: false
  },
  autoReminderCount: {
    type: Number,
    default: 0
  },
  manualReminderCount: {
    type: Number,
    default: 0
  }
})

export default model('Invoice', schema)
