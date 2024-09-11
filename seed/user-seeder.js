import User from '../models/user.js'
import { connect, disconnect } from 'mongoose'

connect(process.env.DB_CONNECTION_STRING, {
  useNewUrlParser: true
})

const users = [
  new User({
    oid: 'unique_string_01',
    displayName: 'Sindelar Jakub',
    email: 'Sindelar.Jakub@example.com',
    IBAN: 'CZ0123456789012345678900',
    keypadId: 1
  }),
  new User({
    oid: 'unique_string_02',
    displayName: 'William Fridgeson',
    email: 'William.Fridgeson@example.com',
    keypadId: 2
  })
]

let done = 0
for (let i = 0; i < users.length; i++) {
  users[i].save().then(() => {
    done++
    if (done === users.length) {
      exit()
    }
  })
}

function exit () {
  disconnect()
}
