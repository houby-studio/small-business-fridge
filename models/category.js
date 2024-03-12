import { Schema, model } from "mongoose";
import uniqueValidator from "mongoose-unique-validator";

var schema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  color: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

schema.plugin(uniqueValidator);

export default model("Category", schema);
