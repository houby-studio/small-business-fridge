var express = require('express')
var router = express.Router()
var ensureAuthenticated = require('../../functions/ensureAuthenticated').ensureAuthenticated
var csrf = require('csurf')
var csrfProtection = csrf()
router.use(csrfProtection)

/* GET admin dashboard page. */
router.get('/', ensureAuthenticated, function (req, res) {
  if (!req.user.admin) {
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
    alert: alert,
    csrfToken: req.csrfToken()
  })
})

module.exports = router
