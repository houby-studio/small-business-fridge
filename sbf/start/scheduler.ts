import scheduler from 'adonisjs-scheduler/services/main'
import NotificationService from '#services/notification_service'
import RecommendationService from '#services/recommendation_service'
import logger from '@adonisjs/core/services/logger'

/**
 * Daily purchase report — Mon-Fri at 16:30
 * Sends each user their daily purchase summary.
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
  .cron('30 16 * * 1-5')

/**
 * Unpaid invoice reminder — Daily at 09:00
 * Reminds buyers about unpaid invoices.
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
  .cron('0 9 * * *')

/**
 * Pending approval reminder — Daily at 09:00
 * Reminds suppliers about payments awaiting their approval.
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
  .cron('0 9 * * *')

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
