/*
 * Tests all routes with no user authenticated
 *
 * All protected routes should redirect to /login
 * /login redirects to login.microsoftonline.com
 *
 * All public routes should load without problem
 *
 */

describe('Routes access with no user logged in', () => {
  const resnap = require('resnap')
  const restore = resnap()
  // Import the dependencies for testing
  var nock = require('nock')
  var sandbox = require('sinon').createSandbox()
  var chai = require('chai')
  var chaiHttp = require('chai-http')
  chai.use(chaiHttp)
  chai.should()

  before(function () {
    restore()
    // mock login.microsoftonline.com to prevent hitting real website
    nock(/login.microsoftonline.com/)
      .persist()
      .get(/.*?/)
      .reply(400, null)
  })
  beforeEach(function () {
    // spy on authenticate() function to validate whether or not it's being called
    passportSpy = sandbox.spy(require('passport'), 'authenticate')
  })

  after(function () {
    nock.restore()
    restore()
  })

  afterEach(function () {
    sandbox.restore()
  })

  describe('Should redirect to /login then login.microsoftonline.com', () => {
  // Test if pages are protected by authentication mechanism
    it('/shop', (done) => {
      chai.request(require('../app'))
        .get('/shop')
        .end(function (_err, res) {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/profile', (done) => {
      chai.request(require('../app'))
        .get('/profile')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/orders', (done) => {
      chai.request(require('../app'))
        .get('/orders')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/invoices', (done) => {
      chai.request(require('../app'))
        .get('/invoices')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/add_products', (done) => {
      chai.request(require('../app'))
        .get('/add_products')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/invoice', (done) => {
      chai.request(require('../app'))
        .get('/invoice')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/payments', (done) => {
      chai.request(require('../app'))
        .get('/payments')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/stock', (done) => {
      chai.request(require('../app'))
        .get('/stock')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/dashboard', (done) => {
      chai.request(require('../app'))
        .get('/dashboard')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
  })
  // Test if pages are NOT protected by authentication mechanism and anyone can access them
  describe('Should NOT require authentication and load properly', () => {
    it('/', (done) => {
      chai.request(require('../app'))
        .get('/')
        .end((_err, res) => {
          sandbox.assert.notCalled(passportSpy)
          res.should.have.not.redirect
          res.should.be.html
          done()
        })
    })
    it('/about', (done) => {
      chai.request(require('../app'))
        .get('/about')
        .end((_err, res) => {
          sandbox.assert.notCalled(passportSpy)
          res.should.have.not.redirect
          res.should.be.html
          done()
        })
    })
    it('/changelog', (done) => {
      chai.request(require('../app'))
        .get('/changelog')
        .end((_err, res) => {
          sandbox.assert.notCalled(passportSpy)
          res.should.have.not.redirect
          res.should.be.html
          done()
        })
    })
  })
  // Test if login redirects to login.microsoftonline.com and logout destroys session
  describe('Should handle login and logout', () => {
    it('/login should redirect to login.microsoftonline.com', (done) => {
      chai.request(require('../app'))
        .get('/login')
        .end((_err, res) => {
          sandbox.assert.calledOnce(passportSpy)
          res.should.have.redirect
          done()
        })
    })
    it('/logout should redirect to /', (done) => {
      chai.request(require('../app'))
        .get('/logout')
        .end((_err, res) => {
          res.should.have.not.cookie()
          res.should.have.redirect
          res.should.have.redirectTo(/127\.0\.0\.1:\d+\//)
          done()
        })
    })
  })
})
