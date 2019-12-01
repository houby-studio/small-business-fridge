// Import the dependencies for testing
var chai = require('chai')
var chaiHttp = require('chai-http')
var app = require('../app')
chai.use(chaiHttp)
chai.should()
describe('API', () => {
  describe('GET /customerName', () => {
    // Test API to load user display name
    it('request with id 1 should return user display name', (done) => {
      chai.request(app)
        .get('/api/customerName?customer=1')
        .set('sbf-API-secret', 'veryveryverysecretapikey')
        .end((_err, res) => {
          res.should.have.status(200)
          res.should.be.json
          res.body.should.eql('Sindelar Jakub')
          done()
        })
    })

    it('request with id 420 should return NOT_FOUND', (done) => {
      chai.request(app)
        .get('/api/customerName?customer=420')
        .set('sbf-API-secret', 'veryveryverysecretapikey')
        .end((_err, res) => {
          res.should.have.status(404)
          res.should.be.json
          res.body.should.eql('NOT_FOUND')
          done()
        })
    })

    // Test API to load user display name without API key
    it('should get 400 bad request', (done) => {
      chai.request(app)
        .get('/api/customerName?customer=1')
        .end((_err, res) => {
          res.should.have.status(400)
          res.should.contain.header('content-type', /application\/problem\+json/)
          done()
        })
    })
  })
})
