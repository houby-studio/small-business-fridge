import { Router } from 'express'
var router = Router()
import { ensureAuthenticated } from '../functions/ensureAuthenticated.js'

/* GET kiosk shop page. */
router.get('/', ensureAuthenticated, function (req, res, next) {
  if (!req.user.kiosk) {
    res.redirect('/')
    return
  }
  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  res.render('shop/kiosk_keypad', {
    title: 'Kiosek | Lednice IT',
    user: req.user,
    alert: alert
  })
})

export default router
