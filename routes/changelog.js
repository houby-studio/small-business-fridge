import { Router } from 'express'
var router = Router()
import { checkKiosk } from '../functions/checkKiosk.js'

/* GET changelog page. */
router.get('/', checkKiosk, function (req, res, next) {
  res.render('shop/changelog', {
    title: 'Changelog | Lednice IT',
    user: req.user
  })
})

export default router
