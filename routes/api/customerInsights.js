import { Router } from 'express'
import { ensureAuthenticatedAPI } from '../../functions/ensureAuthenticatedAPI.js'
import User from '../../models/user.js'
const router = Router()
let responseJson

// GET /api/customerInsights - accepts customer's phone number and returns customer insights to be used by voice bot
router.get('/', ensureAuthenticatedAPI, function (req, res) {
  // Check if request contains 'customer' parameter
  if (!req.query.customer) {
    res.status(400)
    res.set('Content-Type', 'application/problem+json')
    responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerInsights',
      title: "Your request does not contain parameter 'customer'.",
      status: 400,
      'detail:':
        "This function requires parameter 'customer'. More details can be found in documentation https://git.io/JeodS",
      'invalid-params': [
        {
          name: 'customer',
          reason: 'must be specified'
        }
      ]
    }
    res.json(responseJson)
    return
  }

  const formattedPhone = req.query.customer
    .toString()
    .replace(/ /g, '')
    .replace('+', '00')

  console.log('Finding user with phone: ', formattedPhone)

  // Find user in database
  User.findOne({
    phone: formattedPhone
  })
    .then((user) => {
      // If database doesn't contain user with supplied phone, database returns empty object, which doesn't contain any properties.
      res.set('Content-Type', 'application/json')
      if (!user) {
        res.status(404)
        res.json('NOT_FOUND')
      } else {
        res.status(200)
        responseJson = { display_name: user.displayName }
        res.json(responseJson)
      }
    })
    .catch(() => {
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      const responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#customerInsights',
        title: "Your parameter 'customer' is wrong type.",
        status: 400,
        'detail:':
          "Parameter 'customer' must be a 'String'. More details can be found in documentation https://git.io/JeodS",
        'invalid-params': [
          {
            name: 'customer',
            reason:
              'must be a string containing phone number with country code. For example +420 123 456 789.'
          }
        ]
      }
      res.json(responseJson)
    })
})

export default router
