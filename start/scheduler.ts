import scheduler from 'adonisjs-scheduler/services/main'
import NotificationService from '#services/notification_service'
import RecommendationService from '#services/recommendation_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

/**
 * Daily purchase report — Mon-Fri at 16:30 by default.
 * Sends each user their daily purchase summary.
 * Override with CRON_DAILY_REPORT env var.
 */
scheduler
  .call(async () => {
    const service = new NotificationService()
    try {
      await service.sendDailyPurchaseReports()
      logger.info('Daily purchase reports sent')
    } catch (error) {
      logger.error({ err: error }, 'Failed to send daily purchase reports')
    }
  })
  .cron(env.get('CRON_DAILY_REPORT') ?? '30 16 * * 1-5')

/**
 * Unpaid invoice reminder — Mon-Fri at 09:00 by default.
 * Reminds buyers about unpaid invoices older than UNPAID_REMINDER_MIN_AGE_DAYS days (default: 3).
 * Override with CRON_UNPAID_REMINDER env var.
 */
scheduler
  .call(async () => {
    const service = new NotificationService()
    try {
      await service.sendUnpaidInvoiceReminders()
      logger.info('Unpaid invoice reminders sent')
    } catch (error) {
      logger.error({ err: error }, 'Failed to send unpaid invoice reminders')
    }
  })
  .cron(env.get('CRON_UNPAID_REMINDER') ?? '0 9 * * 1-5')

/**
 * Pending approval reminder — Mon-Fri at 09:00 by default.
 * Reminds suppliers about payments awaiting their approval.
 * Override with CRON_PENDING_APPROVAL env var.
 */
scheduler
  .call(async () => {
    const service = new NotificationService()
    try {
      await service.sendPendingApprovalReminders()
      logger.info('Pending approval reminders sent')
    } catch (error) {
      logger.error({ err: error }, 'Failed to send pending approval reminders')
    }
  })
  .cron(env.get('CRON_PENDING_APPROVAL') ?? '0 9 * * 1-5')

/**
 * Statistical recommendations refresh — Daily at 02:00
 * Recomputes purchase predictions for all active users.
 */
scheduler
  .call(async () => {
    const service = new RecommendationService()
    try {
      await service.refreshAll()
      logger.info('Statistical recommendations refreshed')
    } catch (error) {
      logger.error({ err: error }, 'Failed to refresh recommendations')
    }
  })
  .cron('0 2 * * *')
