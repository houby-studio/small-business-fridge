var schedule = require('node-schedule')

var config = require('../config/config.js') // configuration file
var backup = require('../functions/database-backup')

// Schedule rule - should read weekday start and end day + report send hour and minute from config file
var rule = new schedule.RecurrenceRule()
rule.hour = config.tasks.dailyBackup.backupHour
rule.minute = config.tasks.dailyBackup.backupMinute

var dailyBackup = schedule.scheduleJob(rule, function () {
  // This schedule can be disabled in the config
  if (!config.tasks.dailyBackup.enabled) {
    return
  }
  backup.dbAutoBackUp()
})

module.exports = dailyBackup
