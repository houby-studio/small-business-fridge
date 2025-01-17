import { Router } from 'express'
import passport from 'passport'
const router = Router()

// 'POST returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// body (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
router.post(
  '/',
  function (req, res, next) {
    passport.authenticate('azuread-openidconnect', {
      response: res,
      failureRedirect: '/'
    })(req, res, next)
  },
  function (req, res) {
    if (req.user.oid) {
      res.redirect(req.body.state || '/')
    }
  }
)

export default router
