var express = require('express')
var router = express.Router()
var ensureAuthenticatedAPI = require('../../functions/ensureAuthenticatedAPI').ensureAuthenticatedAPI
var User = require('../../models/user')
var responseJson

// GET /api/customerName - accepts customer's keypadId and returns customer's display name
router.get('/', ensureAuthenticatedAPI, function (req, res, next) {
  // Check if request contains 'customer' parameter
  if (!req.query.customer) {
    res.status(400)
    res.set('Content-Type', 'application/problem+json')
    responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerName',
      title: "Your request does not contain parameter 'customer'.",
      status: 400,
      'detail:': "This function requires parameter 'customer'. More details can be found in documentation https://git.io/JeodS",
      'invalid-params': [{
        name: 'customer',
        reason: 'must be specified'
      }]
    }
    res.json(responseJson)
    return
  }

  // Find user in database
  User.findOne({
    keypadId: req.query.customer
  }, function (err, user) {
    if (err) {
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      var responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerName',
        title: "Your parameter 'customer' is wrong type.",
        status: 400,
        'detail:': "Parameter 'customer' must be a 'Number'. More details can be found in documentation https://git.io/JeodS",
        'invalid-params': [{
          name: 'customer',
          reason: 'must be natural number'
        }]
      }
      res.json(responseJson)
      return
    }

    // If database doesn't contain user with supplied keypadId, database returns empty object, which doesn't contain parameter displayName.
    res.set('Content-Type', 'application/json')
    if (!user) {
      res.status(404)
      res.json('NOT_FOUND')
    } else {
      res.status(200)
      var normalized = user.displayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      res.json(normalized)
    }
  })
})

module.exports = router
