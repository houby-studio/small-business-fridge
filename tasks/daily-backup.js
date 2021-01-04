var schedule = require('node-schedule')
var backup = require('../functions/database-backup')

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
var rule = new schedule.RecurrenceRule()
rule.hour = process.env.TASKS_DAILY_BACKUP_HOUR
rule.minute = process.env.TASKS_DAILY_BACKUP_MINUTE

var dailyBackup = schedule.scheduleJob(rule, function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_BACKUP_ENABLED) {
    return
  }
  backup.dbAutoBackUp()
})

module.exports = dailyBackup
