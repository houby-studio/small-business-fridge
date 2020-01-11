var schedule = require('node-schedule')

var config = require('../config/config.js') // configuration file
var Order = require('../models/order')

var rule = new schedule.RecurrenceRule()
rule.dayOfWeek = [0, new schedule.Range(config.tasks.dailyReport.weekDayStart, config.tasks.dailyReport.weekDayEnd)]
rule.hour = config.tasks.dailyReport.sendHour
rule.minute = config.tasks.dailyReport.sendMinute

var dailyReport = schedule.scheduleJob(rule, function () {
  // This schedule can be disabled in the config
  if (!config.tasks.dailyReport.enabled) {
    return
  }

  // Get today (00:00) to get all orders made past that date (today)
  var today = new Date()
  today.setHours(0, 0, 0, 0)

  // Aggregate daily orders for users who have this feature enabled in the profile settings
  Order.aggregate([{
    $match: { order_date: { $gte: today } }
  }],
  function (_err, docs) {
    if (_err) {
      console.log(_err)
    }
    console.log(docs)
  })
  console.log('Schedulers work')
})

module.exports = dailyReport
