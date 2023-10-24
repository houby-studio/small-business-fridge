import { Schema as _Schema, model } from 'mongoose'
var Schema = _Schema

var schema = new Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: Schema.Types.ObjectId,
    ref: 'TemplateType',
    required: true
  },
  message: {
    type: String,
    required: true
  }
})

export default model('MailTemplate', schema)
