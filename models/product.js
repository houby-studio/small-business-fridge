import { Schema, model } from "mongoose";
import uniqueValidator from "mongoose-unique-validator";

var schema = new Schema({
  keypadId: {
    type: Number,
    required: true,
    unique: true,
    min: 0,
  },
  displayName: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  imagePath: {
    type: String,
    required: true,
  },
  category: {
    type: Schema.Types.ObjectId,
    ref: "Category",
    required: false,
  },
  code: {
    type: String,
    required: false,
    index: true,
    unique: true,
    sparse: true,
  },
});

schema.plugin(uniqueValidator);

export default model("Product", schema);
