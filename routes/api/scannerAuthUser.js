import { Router } from 'express'
import { ensureAuthenticatedAPI } from '../../functions/ensureAuthenticatedAPI.js'
import User from '../../models/user.js'
const router = Router()
let responseJson

// GET /api/scannerAuthUser - accepts customer's keypadId or card and returns customer basic information
router.get('/', ensureAuthenticatedAPI, function (req, res) {
  // Check if request contains 'customer' parameter
  if (!req.query.customer) {
    res.status(400)
    res.set('Content-Type', 'application/problem+json')
    responseJson = {
      type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerAuthUser',
      title: "Your request does not contain parameter 'customer'.",
      status: 400,
      'detail:': "This function requires parameter 'customer'.",
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

  // Find user in database
  const filter =
    req.query.customer.toString().length < 6
      ? {
          keypadId: Number(req.query.customer),
          keypadDisabled: { $in: [null, false] }
        }
      : { card: req.query.customer.toString() }
  User.findOne({
    ...filter
  })
    .then((user) => {
      // If database doesn't contain user with supplied keypadId or card, database returns empty object, which doesn't contain user object.
      res.set('Content-Type', 'application/json')
      if (!user) {
        res.status(404)
        res.json('NOT_FOUND')
      } else {
        res.status(200)
        const response = {
          _id: user._id,
          displayName: user.displayName,
          admin: user.admin,
          supplier: user.supplier
        }
        res.json(response)
      }
    })
    .catch(() => {
      res.status(400)
      res.set('Content-Type', 'application/problem+json')
      const responseJson = {
        type: 'https://github.com/houby-studio/small-business-fridge/wiki/API-documentation#scannerAuthUser',
        title: "Your parameter 'customer' is wrong type.",
        status: 400,
        'detail:':
          "Parameter 'customer' must be either a 'Number' with max value 99999 or a 'String' with minimum length of 6.",
        'invalid-params': [
          {
            name: 'customer',
            reason: 'must be number or string'
          }
        ]
      }
      res.json(responseJson)
    })
})

export default router
