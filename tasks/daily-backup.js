import { RecurrenceRule, scheduleJob } from 'node-schedule'
import dbAutoBackUp from '../functions/database-backup.js'

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
var rule = new RecurrenceRule()
rule.hour = process.env.TASKS_DAILY_BACKUP_HOUR
rule.minute = process.env.TASKS_DAILY_BACKUP_MINUTE

var dailyBackup = scheduleJob(rule, function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_BACKUP_ENABLED) {
    return
  }
  dbAutoBackUp.dbAutoBackUp()
})

export default dailyBackup
