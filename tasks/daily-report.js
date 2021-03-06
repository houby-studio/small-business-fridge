var schedule = require('node-schedule')
var mailer = require('../functions/sendMail')
var User = require('../models/user')

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
var rule = new schedule.RecurrenceRule()
rule.dayOfWeek = new schedule.Range(process.env.TASKS_DAILY_REPORT_WEEK_START, process.env.TASKS_DAILY_REPORT_WEEK_END)
rule.hour = process.env.TASKS_DAILY_REPORT_SEND_HOUR
rule.minute = process.env.TASKS_DAILY_REPORT_SEND_MINUTE

var dailyReport = schedule.scheduleJob(rule, function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_REPORT_ENABLED) {
    return
  }

  // Get today (00:00) to get all orders made past that date (today)
  var today = new Date()
  today.setHours(0, 0, 0, 0)

  // Aggregate daily orders for users who have this feature enabled in the profile settings
  User.aggregate([{
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
          cond: { $gte: ['$$order.order_date', today] }
        }
      }
    }
  }
  ],
    function (_err, docs) {
      if (_err) {
        console.log(_err)
      }
      for (let i = 0; i < docs.length; i++) {
        // Send e-mail to each user with their today's order count.
        var subject
        var body
        if (docs[i].todays_orders.length > 0) {
          subject = `Dnes zakoupeno ${docs[i].todays_orders.length} produktů v Lednici IT!`
          body = `<header><h1>Děkujeme za Vaši důvěru!</h1></header><section><article><p>Posíláme každodenní report o Vašich nákupech v Lednici IT.</p><p>Dnes se Vám podařilo zakoupit celkem ${docs[i].todays_orders.length} produktů. Detailní seznam můžete kdykoli zkontrolovat na <a href="https://lednice.prdelka.eu/orders">e-shopu Lednice IT</a>.</p><p>S pozdravem, Vaše Lednice IT.</p></article></section><aside><i>Poznámka: Pokud nejste pravidelným zákazníkem Lednice IT, můžete si tyto notifikace vypnout ve <a href="https://lednice.prdelka.eu/profile">Vašem profilu na e-shopu</a>.</i></aside>`
        } else {
          subject = 'Dnes jste si nic nezakoupili!'
          body = '<header><h1>To nás překvapujete!</h1></header><section><article><p>Dnes jsme na našem e-shopu nezaznamenali žádnou objednávku od Vás.</p><p>K tomu mohlo dojít hned z několika důvodů:</p><ul><li>Zapomněl jste svou objednávku zaevidovat v e-shopu</li><li>Nic jste si dnes nezakoupil, což nás velice mrzí</li><li>Soudruzi z NDR udělali chybu a e-shop objednávku neuložil do databáze</li></ul><p>Zamyslete se, zda jste skutečně dnes nic nevypil a svou případnou chybu okamžitě napravte.</p><p>S pozdravem, Vaše Lednice IT.</p></article></section><aside><i>Poznámka: Pokud nejste pravidelným zákazníkem Lednice IT, můžete si tyto notifikace vypnout ve <a href="https://lednice.prdelka.eu/profile">Vašem profilu na e-shopu</a>.</i></aside>'
        }
        mailer.sendMail(docs[i].email, subject, body)
      }
    })
})

module.exports = dailyReport
