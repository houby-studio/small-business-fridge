var User = require('../models/user')
var config = require('../config/config')
var mongoose = require('mongoose')

mongoose.connect(config.config.db.connstr, {
  useNewUrlParser: true
})

var users = [
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

var done = 0
for (var i = 0; i < users.length; i++) {
  users[i].save(function (_err, _result) {
    done++
    if (done === users.length) {
      exit()
    }
  })
}

function exit () {
  mongoose.disconnect()
}
