import { RecurrenceRule, Range, scheduleJob } from 'node-schedule'
import { sendMail } from '../functions/sendMail.js'
import logger from '../functions/logger.js'
import User from '../models/user.js'

function getSubject(purchaseCount) {
  switch (true) {
    case purchaseCount === 0:
      return 'Za posledních 24 hodin jste nezakoupili ani jeden produkt'
    case purchaseCount === 1:
      return `Pouze ${purchaseCount} produkt zakoupen za posledních 24 hodin`
    case purchaseCount < 5:
      return `Uspokojivé ${purchaseCount} produkty zakoupeny za posledních 24 hodin`
    default:
      return `Neuvěřitelných ${purchaseCount} produktů zakoupeno za posledních 24 hodin`
  }
}

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
const rule = new RecurrenceRule()
rule.dayOfWeek = new Range(
  process.env.TASKS_DAILY_REPORT_WEEK_START || 1,
  process.env.TASKS_DAILY_REPORT_WEEK_END || 5
)
rule.hour = process.env.TASKS_DAILY_REPORT_SEND_HOUR || 16
rule.minute = process.env.TASKS_DAILY_REPORT_SEND_MINUTE || 30

const scheduledTask = scheduleJob(rule, function () {
  // This schedule can be disabled in the ENV
  if (process.env.TASKS_DAILY_REPORT_ENABLED.toLowerCase() !== 'true') {
    return
  }

  logger.info(
    'server.tasks.dailypurchasereport__Started scheduled task to notify customers of their purchases in past 24 hours.'
  )

  // Get all orders from past 24 hours
  const daysAgo = new Date(Date.now() - 86400 * 1000)

  // Aggregate daily orders for users who have this feature enabled in the profile settings
  User.aggregate([
    {
      $match: { sendDailyReport: true }
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'buyerId',
        as: 'orders'
      }
    },
    {
      $project: {
        email: 1,
        todays_orders: {
          $filter: {
            input: '$orders',
            as: 'order',
            cond: { $gte: ['$$order.order_date', daysAgo] }
          }
        }
      }
    }
  ])
    .then((docs) => {
      logger.debug(
        `server.tasks.dailypurchasereport__Successfully loaded ${docs.length} customers with preference to receive daily purchase report.`,
        {
          metadata: {
            result: docs
          }
        }
      )
      for (let i = 0; i < docs.length; i++) {
        // Send e-mail to each user with their today's purchases count.
        const purchaseCount = docs[i].todays_orders.length
        const subject = getSubject(purchaseCount)

        sendMail(docs[i].email, 'dailyPurchaseReport', {
          subject,
          purchaseCount
        })
      }
    })
    .catch((err) => {
      logger.error(
        'server.tasks.dailypurchasereport__Failed to load customers and their daily purchases.',
        {
          metadata: {
            error: err.message
          }
        }
      )
    })
})

export default scheduledTask
