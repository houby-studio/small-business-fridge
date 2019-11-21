var chaosMonkey = require('chaos-monkey')
var chai = require('chai')
var chaiHttp = require('chai-http')
chai.use(chaiHttp)
chai.should()
var app = require('../app')
var agent = chai.request(app)
var monkeyConfig = { name: 'uncaught-exception', file: 'uncaught-exception', active: true, properties: { message: 'Uncaught exception was thrown by the chaos monkey' }, schedule: { type: 'one-time-schedule', delay: 2000 } }
chaosMonkey.initialize(app, monkeyConfig)

describe('Chaos monkey', () => {
  describe('invoke POST request and trigger chaos', () => {
    it('/chaos/random should not kill process', (done) => {
      agent
        .post('/chaos/pranks')
        .then(function (res) {
          return agent.get('/')
            .then(function (res) {
              res.should.have.status(200)
            })
        })
    }).timeout(320)
  })
})
