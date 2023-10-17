import mongoose, { Schema } from 'mongoose'

const userSchema = new Schema({
  oid: {
    type: String,
    required: true
  },
  displayName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  IBAN: {
    type: String,
    minlength: 24,
    maxlength: 24
  },
  keypadId: {
    type: Number,
    required: true
  },
  admin: {
    type: Boolean,
    default: false
  },
  supplier: {
    type: Boolean,
    default: false
  },
  kiosk: {
    type: Boolean,
    default: false
  },
  showAllProducts: {
    type: Boolean,
    default: false
  },
  sendMailOnEshopPurchase: {
    type: Boolean,
    default: true
  },
  sendDailyReport: {
    type: Boolean,
    default: true
  }
})

const model = mongoose.model('User', userSchema)

export const schema = model.schema
export default model
