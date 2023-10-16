/*
 * Tests customerName API
 *
 * Calling API without secret should return 401 UNAUTHORIZED
 *
 * Calling API with invalid or non-existing ID should return 404 NOT FOUND
 *
 * Calling API with valid ID should return normalized user display name
 *
 */

describe('customerName API', () => {
  // Capture cache state before tests
  const resnap = require('resnap')
  const restore = resnap()
  // Import the dependencies for testing
  var chai = require('chai')
  var chaiHttp = require('chai-http')
  chai.use(chaiHttp)
  chai.should()
  // Variables for test
  var app

  describe('GET /customerName', () => {
    before(function () {
      // Require express app
      app = require('../app')
    })

    after(function () {
      // Restore cache state
      restore()
    })

    it('request with id 1 should return user display name', (done) => {
      chai
        .request(app)
        .get('/api/customerName?customer=1')
        .set('sbf-API-secret', 'veryveryverysecretapikey')
        .end((_err, res) => {
          res.should.have.status(200)
          res.should.be.json
          res.body.should.eql('Sindelar Jakub')
          done()
        })
    })

    it('request with id 420 should return 404 NOT FOUND', (done) => {
      chai
        .request(app)
        .get('/api/customerName?customer=420')
        .set('sbf-API-secret', 'veryveryverysecretapikey')
        .end((_err, res) => {
          res.should.have.status(404)
          res.should.be.json
          res.body.should.eql('NOT_FOUND')
          done()
        })
    })

    it('request without customer should return 400 BAD REQUEST', (done) => {
      chai
        .request(app)
        .get('/api/customerName')
        .set('sbf-API-secret', 'veryveryverysecretapikey')
        .end((_err, res) => {
          res.should.have.status(400)
          res.should.contain.header(
            'content-type',
            /application\/problem\+json/
          )
          done()
        })
    })

    it('request without API key should return 401 UNAUTHORIZED', (done) => {
      chai
        .request(app)
        .get('/api/customerName?customer=1')
        .end((_err, res) => {
          res.should.have.status(401)
          res.should.contain.header(
            'content-type',
            /application\/problem\+json/
          )
          done()
        })
    })
  })
})
