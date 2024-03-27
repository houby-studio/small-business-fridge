import { Schema, model } from "mongoose";
import uniqueValidator from "mongoose-unique-validator";

var schema = new Schema({
  name: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  color: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
    index: true,
  },
});

schema.plugin(uniqueValidator);

export default model("Category", schema);
