import { Router } from 'express'
import { checkKiosk } from '../functions/checkKiosk.js'
var router = Router()

/* GET docs page. */
router.get('/', checkKiosk, function (req, res, next) {
  res.render('shop/docs', {
    title: 'Changelog | Lednice IT',
    user: req.user
  })
})

export default router
