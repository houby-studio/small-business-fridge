import { Router } from 'express'
import passport from 'passport'
var router = Router()

// Who knows why it's there. Seems to be working without this file. Whatever.
router.get(
  '/',
  passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/login'
  }),
  function (req, res) {
    res.redirect('/')
  }
)

export default router
