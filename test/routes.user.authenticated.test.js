// This test file tries all possible routes with regular user logged in
// Supplier and admin routes should redirect to /login
// Customer and public routes should load without problem

describe('Routes access with customer user logged in', () => {
  // Import the dependencies for testing
  const resnap = require('resnap')
  const restore = resnap()
  var nock = require('nock')
  var sandbox = require('sinon').createSandbox()
  var decache = require('decache')
  var chai = require('chai')
  var chaiHttp = require('chai-http')
  chai.use(chaiHttp)
  chai.should()

  describe('Should load with logged in customer', () => {
    before(function () {
      // delete module.cache[require.resolve('ensureAuthenticated')]
      // delete require.cache[require.resolve('../app')]
      // delete require.cache[require.resolve('../functions/ensureAuthenticated')]
      // restore()
      decache('../functions/ensureAuthenticated')
    })

    beforeEach(function () {
      // spyAuth = sandbox.spy(require('../functions/ensureAuthenticated'), 'ensureAuthenticated')
      sandbox = require('sinon').createSandbox().stub(require('../functions/ensureAuthenticated'), 'ensureAuthenticated')
        .callsFake(function (req, res, next) {
          console.log('eee')
          return next()
        })
    })

    after(function () {
      restore()
    })

    afterEach(function () {
      sandbox.restore()
    })

    it('/shop should load shop page without redirect', (done) => {
      delete require.cache[require.resolve('../app')]
      chai.request(require('../app'))
        .get('/shop')
        .end(function (_err, res) {
          // console.log(res)
          // sandbox.assert.calledOnce(spyAuth)
          res.should.not.redirect
          done()
        })
    })
  })
})
