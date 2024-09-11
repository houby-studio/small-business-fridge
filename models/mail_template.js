import { Schema, model } from 'mongoose'

const schema = new Schema({
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
