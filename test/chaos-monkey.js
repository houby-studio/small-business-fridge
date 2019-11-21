const ChaosMonkey = require('chaos-monkey')
var chai = require('chai')
var chaiHttp = require('chai-http')
chai.use(chaiHttp)
chai.should()
var app = require('../app')
ChaosMonkey.initialize(app)

describe('Chaos monkey', () => {
  describe('invoke POST request and trigger chaos', () => {
    it('/chaos/random should not kill process', (done) => {
      var agent = chai.request(app)
      agent
        .post('/chaos/random')
        .then(function (res) {
          return agent.get('/')
            .then(function (res) {
              res.should.have.status(200)
            })
        })
    })
  })
})
