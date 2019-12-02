/*
 * Tests all routes with user authenticated
 *
 * All supplier and admin routes should redirect to /login
 * /login redirects to login.microsoftonline.com
 *
 * All customer and public routes should load without problem
 *
 */

describe('Routes access with customer user logged in', () => {
  // Capture cache state before tests
  const resnap = require('resnap')
  const restore = resnap()
  // Import the dependencies for testing
  var sandbox = require('sinon').createSandbox()
  var chai = require('chai')
  var chaiHttp = require('chai-http')
  chai.use(chaiHttp)
  chai.should()
  // Variables for test
  var app

  describe('Should load with logged in customer', () => {
    beforeEach(function () {
      // Fake ensureAuthenticated function to skip checking whether user is or isn't logged in.
      sandbox = require('sinon').createSandbox().stub(require('../functions/ensureAuthenticated'), 'ensureAuthenticated')
        .callsFake(function (req, res, next) {
          return next()
        })
      // Require express app
      app = require('../app')
    })

    after(function () {
      // Restore cache state
      restore()
    })

    afterEach(function () {
      // restore sinon stubs and spies
      sandbox.restore()
    })

    it('/shop should load shop page without redirect', (done) => {
      // TODO, add object to req and load full page without error
      chai.request(app)
        .get('/shop')
        .end(function (_err, res) {
          res.should.not.redirect
          done()
        })
    })
  })
})
