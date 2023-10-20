import { Router } from 'express'
import passport from 'passport'
var router = Router()

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
