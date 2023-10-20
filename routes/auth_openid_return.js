import { Router } from 'express'
import passport from 'passport'
var router = Router()

// 'GET returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// query (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
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
