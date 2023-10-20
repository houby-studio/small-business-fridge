import { Router } from 'express'
import { checkKiosk } from '../functions/checkKiosk.js'
var router = Router()

/* GET home page. */
router.get('/', checkKiosk, function (req, res, next) {
  if (req.session.alert) {
    var alert = req.session.alert
    delete req.session.alert
  }
  res.render('shop/index', {
    title: 'Index | Lednice IT',
    user: req.user,
    alert: alert
  })
})

export default router
