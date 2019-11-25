// This test file tries all possible routes without authenticated user
// Protected routes should redirect to /login
// Public routes should load without problem

// Import the dependencies for testing
var nock = require('nock')
var sinon = require('sinon')
var chai = require('chai')
var chaiHttp = require('chai-http')
chai.use(chaiHttp)
chai.should()

// Import required app files
var app

describe('Routes access with no user logged in', () => {

  beforeEach(function () {
    this.consoleStub = sinon.stub(console, 'log')
    nock(/login.microsoftonline.com/)
      .persist()
      .get(/.*?/)
      .reply(500, null)

    app = require('../app')
  })

  afterEach(function () {
    nock.cleanAll()
    this.consoleStub.restore()
  })

  describe('Should require authenticated user', () => {
  // Test if pages are protected by authentication mechanism
    it('/shop should redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/shop')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/profile redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/profile')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/orders redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/orders')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/invoices redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/invoices')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/add_products redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/add_products')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/invoice redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/invoice')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/payments redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/payments')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/stock redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/stock')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/dashboard redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/dashboard')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
  })
  describe('Should NOT require authentication', () => {
    it('/ should not require authentication', (done) => {
      chai.request(app)
        .get('/')
        .end((_err, res) => {
          res.should.have.not.redirect
          res.should.be.html
          done()
        })
    })
    it('/about should not require authentication', (done) => {
      chai.request(app)
        .get('/about')
        .end((_err, res) => {
          res.should.have.not.redirect
          res.should.be.html
          done()
        })
    })
    it('/changelog should not require authentication', (done) => {
      chai.request(app)
        .get('/changelog')
        .end((_err, res) => {
          res.should.have.not.redirect
          res.should.be.html
          done()
        })
    })
  })
  describe('Should handle login and logout', () => {
    it('/login should redirect to login.microsoftonline.com', (done) => {
      chai.request(app)
        .get('/login')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/login.microsoftonline.com/)
          done()
        })
    })
    it('/logout should redirect to /', (done) => {
      chai.request(app)
        .get('/logout')
        .end((_err, res) => {
          res.should.have.redirect
          res.should.have.redirectTo(/127\.0\.0\.1:\d+\//)
          done()
        })
    })
  })
})
