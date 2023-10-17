import { Router } from 'express'
var router = Router()
import passport from 'passport'

/* GET login page. */
router.get(
  '/',
  function (req, res, next) {
    passport.authenticate('azuread-openidconnect', {
      response: res,
      failureRedirect: '/'
    })(req, res, next)
  },
  function (req, res) {
    res.redirect('/')
  }
)

export default router
