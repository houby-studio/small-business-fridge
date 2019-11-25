// This test file tries all possible routes with regular user logged in
// Supplier and admin routes should redirect to /login
// Customer and public routes should load without problem

// Import the dependencies for testing
var chai = require('chai')
var chaiHttp = require('chai-http')
chai.use(chaiHttp)
chai.should()
var sinon = require('sinon')
var app
var ensureAuthenticated

describe('Routes access with customer user logged in', () => {
  describe('Should load with logged in customer', () => {
    beforeEach(function () {
      ensureAuthenticated = require('../functions/ensureAuthenticated')
      sinon.stub(ensureAuthenticated, 'ensureAuthenticated')
        .callsFake(function (req, res, next) {
          console.log('lmao')
          return next()
        })
      app = require('../app')
    })

    afterEach(function () {
      //sinon.restore()
    // restore original method
    // ensureAuthenticated.ensureAuthenticated.restore()
    })

    it('/shop should load shop page', (done) => {
      chai.request(app)
        .get('/shop')
        .end(function (_err, res) {
          res.should.have.header('ay', 'lmao')
          done()
        })
    })
  })
})
