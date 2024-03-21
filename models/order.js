import { Schema, model } from "mongoose";

var schema = new Schema({
  buyerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  deliveryId: {
    type: Schema.Types.ObjectId,
    ref: "Delivery",
    required: true,
  },
  order_date: {
    type: Date,
    default: Date.now,
  },
  invoice: {
    type: Boolean,
    default: false,
  },
  invoiceId: {
    type: Schema.Types.ObjectId,
    ref: "Invoice",
    required: false,
  },
  keypadOrder: {
    type: Boolean,
    default: false,
  },
  scannerOrder: {
    type: Boolean,
    default: false,
  },
});

export default model("Order", schema);
