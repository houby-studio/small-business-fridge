import { Router } from 'express'
import { checkKiosk } from '../functions/checkKiosk.js'
var router = Router()

/* GET about page. */
router.get('/', checkKiosk, function (req, res) {
  res.render('shop/about', {
    title: 'O aplikaci | Lednice IT',
    user: req.user
  })
})

export default router
