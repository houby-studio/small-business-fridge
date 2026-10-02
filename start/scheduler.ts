import scheduler from 'adonisjs-scheduler/services/main'
import NotificationService from '#services/notification_service'
import RecommendationService from '#services/recommendation_service'
import AnonymizationService from '#services/anonymization_service'
import OffContributionService from '#services/product_images/off_contribution_service'
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

/**
 * Anonymize accounts that have been disabled for ANONYMIZE_GRACE_DAYS (default 7).
 * Wipes PII and detaches external identities so the slot becomes a faceless
 * audit anchor. Runs daily at 03:00; override via CRON_ANONYMIZE_DISABLED.
 * Disabled by default — set ANONYMIZE_DISABLED_USERS=true to opt in (typically
 * only in production; test environments leave it off for reproducible seeds).
 */
scheduler
  .call(async () => {
    const graceDays = env.get('ANONYMIZE_GRACE_DAYS') ?? AnonymizationService.DEFAULT_GRACE_DAYS
    const service = new AnonymizationService()
    if (env.get('ANONYMIZE_DISABLED_USERS') !== true) {
      // Skipping is the default, so a production instance can silently keep personal data of
      // people who left for months. Say so whenever it actually matters.
      const due = await service.countDue(graceDays).catch(() => 0)
      if (due > 0) {
        logger.warn(
          { graceDays, due },
          'Disabled accounts past the grace period are not anonymized: ANONYMIZE_DISABLED_USERS is off'
        )
      } else {
        logger.debug('Anonymization cron skipped (ANONYMIZE_DISABLED_USERS not enabled)')
      }
      return
    }
    try {
      const summary = await service.anonymizeDisabledUsers(graceDays)
      logger.info({ graceDays, ...summary }, 'Anonymization sweep completed for disabled accounts')
    } catch (error) {
      logger.error({ err: error }, 'Anonymization sweep failed')
    }
  })
  .cron(env.get('CRON_ANONYMIZE_DISABLED') ?? '0 3 * * *')

/**
 * Open Food Facts contributions — every 2 minutes, only when the instance has an OFF
 * account. Sends the EAN, name and photos suppliers agreed to share; failed rounds retry
 * with a growing delay (docs/product-images.md). One round at a time: a round may run a
 * background-removal model for every photo.
 */
scheduler
  .call(async () => {
    if (!OffContributionService.isEnabled()) return
    try {
      const sent = await new OffContributionService().processDue()
      if (sent > 0) logger.info({ sent }, 'Open Food Facts contributions processed')
    } catch (error) {
      logger.error({ err: error }, 'Failed to process Open Food Facts contributions')
    }
  })
  .everyTwoMinutes()
  .withoutOverlapping()
