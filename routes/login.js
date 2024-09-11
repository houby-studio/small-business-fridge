import { Router } from 'express'
import passport from 'passport'
const router = Router()

/* GET login page. */
router.get(
  '/',
  function (req, res, next) {
    passport.authenticate('azuread-openidconnect', {
      response: res,
      failureRedirect: '/',
      customState: req.query.originalUrl ? req.query.originalUrl : '/'
    })(req, res, next)
  },
  function (req, res) {
    res.redirect('/')
  }
)

export default router
