import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import logger from '../../functions/logger.js'
var router = Router()

function limiterHandler(req, res, _next, options) {
  if (req.url.startsWith('/api/')) {
    logger.warn(
      `server.routes.middleware.ratelimit.post__API user hit rate limit on IP address:[${req.client.remoteAddress}].`,
      {
        metadata: {
          result: req.url
        }
      }
    )
    res.status(options.statusCode).send(options.message)
    return
  }
  logger.warn(
    `server.routes.middleware.ratelimit.post__User:[${req.user.displayName}] hit rate limit on IP address:[${req.client.remoteAddress}].`,
    {
      metadata: {
        result: req.url
      }
    }
  )
  const alert = {
    type: 'danger',
    component: 'web',
    message: 'Příliš mnoho požadavků! Zkuste to prosím znovu za minutu.',
    danger: 1
  }
  req.session.alert = alert
  res.redirect(req.url)
  return
}

// Redirect with alert
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: async (req, res) => {
    if (req.client.remoteAddress === process.env.APP_RATE_LIMIT_TRUSTED_IP) {
      return 60000 // 1000 requests per second is to be considered as unlimited
    }
    return process.env.APP_RATE_LIMIT_PER_MIN // Set limit as ENV variable - default 25
  },
  standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: limiterHandler
})

router.post('*', limiter)

export default router
