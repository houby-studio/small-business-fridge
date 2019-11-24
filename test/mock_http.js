// Import the dependencies for testing
var chai = require('chai')
var chaiHttp = require('chai-http')
chai.use(chaiHttp)
chai.should()
var sinon = require('sinon')
var app
var ensureAuthenticated

describe('Log in user', () => {
  // var fake = sinon.fake.yields(null, true)
  // sinon.replace(req, 'isAuthenticated', fake)
  // beforeEach(() => {
  //   // this.authenticate = sinon.stub(passport, 'authenticate').returns(() => {})
  //   // this.authenticate.yields(null, { id: 1 })
  //   //this.ensureAuthenticated = sinon.stub(helperAuth, 'ensureAuthenticated').returns(() => {})
  //   // sinon.stub(helperAuth, 'ensureAuthenticated').returns({})
  //   // this.isAuthenticated = sinon.stub()
  //   // this.isAuthenticated.yields(true)
  // })
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
