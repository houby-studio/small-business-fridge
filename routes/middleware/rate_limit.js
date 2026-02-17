import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import logger from '../../functions/logger.js'

const router = Router()

function normalizeIp(raw) {
  if (!raw) return 'unknown'

  // If we got the XFF list, take the first hop
  let ip = raw.split(',')[0].trim()

  // Handle IPv6-in-brackets like: "[::1]:1234"
  const bracket = ip.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracket) ip = bracket[1]

  // Strip IPv4 port like: "1.2.3.4:5678"
  if (ip.includes('.') && ip.includes(':')) ip = ip.split(':')[0]

  // Strip IPv4-mapped IPv6 prefix "::ffff:1.2.3.4"
  ip = ip.replace(/^::ffff:/, '')

  return ip
}

function limiterHandler(req, res, _next, options) {
  const ip = normalizeIp(req.ip || req.socket?.remoteAddress)

  if (req.url.startsWith('/api/')) {
    logger.warn(
      `server.routes.middleware.ratelimit.post__API user hit rate limit on IP address:[${ip}].`,
      { metadata: { result: req.url } }
    )
    res.status(options.statusCode).send(options.message)
    return
  }

  logger.warn(
    `server.routes.middleware.ratelimit.post__User:[${req.user?.displayName}] hit rate limit on IP address:[${ip}].`,
    { metadata: { result: req.url } }
  )

  req.session.alert = {
    type: 'danger',
    component: 'web',
    message: 'Příliš mnoho požadavků! Zkuste to prosím znovu za minutu.',
    danger: 1
  }

  res.redirect(req.url)
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: async (req) => {
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress)
    if (ip === process.env.APP_RATE_LIMIT_TRUSTED_IP) return 60000
    return Number(process.env.APP_RATE_LIMIT_PER_MIN ?? 25)
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limiterHandler,

  keyGenerator: (req) => {
    const xff = req.headers['x-forwarded-for']
    const raw = (Array.isArray(xff) ? xff[0] : xff) || req.ip || req.socket?.remoteAddress
    return normalizeIp(String(raw))
  }
})

router.post('*', limiter)
export default router
