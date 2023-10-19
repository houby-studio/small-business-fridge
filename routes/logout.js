import { Router } from 'express'
var router = Router()

// 'logout' route, logout from passport, and destroy the session with AAD.
router.get('/', function (req, res, next) {
  //req.session.cookie.expires = new Date().getTime()
  req.session.destroy(function (_err) {
    res.redirect(
      'https://login.microsoftonline.com/common/oauth2/logout?post_logout_redirect_uri=' +
        process.env.CREDS_DESTROY_SESSION_URL
    )
    //req.logOut
  })
})

export default router
