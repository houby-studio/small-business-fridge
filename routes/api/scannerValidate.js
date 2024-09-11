import { Router } from 'express'
import { ensureAuthenticatedAPI } from '../../functions/ensureAuthenticatedAPI.js'
const router = Router()

// GET /api/scannerValidate - Validates connection when setting up scanner
router.get('/', ensureAuthenticatedAPI, function (req, res) {
  res.set('Content-Type', 'application/json')
  res.status(200)
  res.json('OK')
})

export default router
