import { Router } from 'express'
import { ensureAuthenticated } from '../../functions/ensureAuthenticated.js'
import csrf from 'csurf'
import logger from '../../functions/logger.js'
const router = Router()
const csrfProtection = csrf()
router.use(csrfProtection)

/* GET admin dashboard page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      'server.routes.admindashboard.get__User tried to access admin page without permission.',
      {
        metadata: {
          result: req.user
        }
      }
    )
    res.redirect('/')
    return
  }
  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  res.render('admin/admin_dashboard', {
    title: 'Dashboard | Lednice IT',
    user: req.user,
    alert,
    csrfToken: req.csrfToken()
  })
})

export default router
