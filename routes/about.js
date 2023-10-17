import { Router } from 'express'
var router = Router()
import { checkKiosk } from '../functions/checkKiosk.js'

/* GET about page. */
router.get('/', checkKiosk, function (req, res, next) {
  res.render('shop/about', {
    title: 'O aplikaci | Lednice IT',
    user: req.user
  })
})

export default router
