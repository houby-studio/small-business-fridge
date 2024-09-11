import { Router } from 'express'
import { checkKiosk } from '../functions/checkKiosk.js'
const router = Router()

/* GET docs page. */
router.get('/', checkKiosk, function (req, res) {
  res.render('shop/docs', {
    title: 'Dokumentace | Lednice IT',
    user: req.user
  })
})

export default router
