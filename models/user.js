import { Schema, model } from "mongoose";
import uniqueValidator from "mongoose-unique-validator";

const schema = new Schema({
  oid: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  displayName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  IBAN: {
    type: String,
    minlength: 24,
    maxlength: 24,
  },
  keypadId: {
    type: Number,
    required: true,
    maxlength: 5,
    index: true,
  },
  admin: {
    type: Boolean,
    default: false,
  },
  supplier: {
    type: Boolean,
    default: false,
  },
  kiosk: {
    type: Boolean,
    default: false,
  },
  showAllProducts: {
    type: Boolean,
    default: false,
  },
  sendMailOnEshopPurchase: {
    type: Boolean,
    default: true,
  },
  sendDailyReport: {
    type: Boolean,
    default: true,
  },
  favorites: [
    {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: false,
    },
  ],
  colorMode: { type: String, enum: ["light", "dark"] },
  theme: { type: String, enum: ["happy", "angry", "shocked"] },
  keypadDisabled: { type: Boolean, default: false },
  card: {
    type: String,
    required: false,
    minlength: 6,
    index: true,
    unique: true,
    sparse: true,
  },
});

schema.plugin(uniqueValidator);

// userSchema.index({});

export default model("User", schema);
