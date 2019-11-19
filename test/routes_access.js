// Import the dependencies for testing
var chai = require('chai')
var chaiHttp = require('chai-http')
var app = require('../app')
chai.use(chaiHttp)
chai.should()

// Attempt to login, logout
describe('Routes access', () => {
  describe('Should require authentication', () => {
  // Test if pages are protected by authentication mechanism
    it('/shop should redirect to /login then microsoft', (done) => {
      chai.request(app)
        .get('/shop')
        .end((_err, res) => {
        // res.should.have.header('test-url', '/shop')
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
