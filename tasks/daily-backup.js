import { RecurrenceRule, scheduleJob } from 'node-schedule'
import dbAutoBackUp from '../functions/database-backup.js'
import logger from '../functions/logger.js'

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
var rule = new RecurrenceRule()
rule.hour = process.env.TASKS_DAILY_BACKUP_HOUR
rule.minute = process.env.TASKS_DAILY_BACKUP_MINUTE

var dailyBackup = scheduleJob(rule, function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_BACKUP_ENABLED) {
    return
  }

  logger.info(
    `server.tasks.dailybackup__Started scheduled task to backup database.`
  )

  dbAutoBackUp()
})

export default dailyBackup
