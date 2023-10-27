import { RecurrenceRule, Range, scheduleJob } from 'node-schedule'
import { sendMail } from '../functions/sendMail.js'
import { generateQR } from '../functions/qrPayment.js'
import Invoice from '../models/invoice.js'
import logger from '../functions/logger.js'

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
var rule = new RecurrenceRule()
// rule.dayOfWeek = new Range(
//   process.env.TASKS_DAILY_REPORT_WEEK_START,
//   process.env.TASKS_DAILY_REPORT_WEEK_END
// )
rule.hour = process.env.TASKS_DAILY_INCOMPLETE_INVOICE_HOUR
rule.minute = process.env.TASKS_DAILY_INCOMPLETE_INVOICE_MINUTE

// replace '* * * * *' with rule
var dailyReport = scheduleJob('*/5 * * * * *', function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_INCOMPLETE_INVOICE_ENABLED) {
    return
  }

  // Get today (00:00) to get all orders made past that date (today)
  const today = new Date()
  const daysAgo = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() -
      (process.env.TASKS_DAILY_INCOMPLETE_INVOICE_NET_DAYS || 14)
  )
  console.log(daysAgo)

  // Aggregate unpaid invoices older than TASKS_DAILY_INCOMPLETE_INVOICE_NET_DAYS days
  Invoice.aggregate([
    {
      $match: {
        $and: [
          { paid: false },
          { requestPaid: false },
          { invoiceDate: { $lte: daysAgo } }
        ]
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: 'buyerId',
        foreignField: '_id',
        as: 'buyer'
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: 'supplierId',
        foreignField: '_id',
        as: 'supplier'
      }
    },
    {
      $project: {
        _id: 1,
        totalCost: 1,
        invoiceDate: 1,
        autoReminderCount: 1,
        buyer: {
          displayName: 1,
          email: 1
        },
        supplier: {
          displayName: 1,
          email: 1,
          IBAN: 1
        }
      }
    }
  ])
    .then((docs) => {
      logger.debug(
        `server.tasks.dailyunpaidinvoices__Successfully loaded ${docs.length} past due invoices.`,
        {
          metadata: {
            result: docs
          }
        }
      )
      for (let i = 0; i < docs.length; i++) {
        // Increment automatic reminder count on unpaid invoices
        Invoice.findByIdAndUpdate(docs[i]._id, {
          $inc: { autoReminderCount: 1 }
        })
          .then((result) => {
            logger.info(
              `server.tasks.dailyunpaidinvoices__Successfully incremented autoReminderCount:[${result.autoReminderCount}] on invoice:[${docs[i]._id}].`,
              {
                metadata: {
                  result: result
                }
              }
            )
          })
          .catch((err) => {
            logger.error(
              `server.tasks.dailyunpaidinvoices__Failed to increment autoReminderCount:[${result.autoReminderCount}] on invoice:[${docs[i]._id}].`,
              {
                metadata: {
                  error: err
                }
              }
            )
          })
        // Generate QR code and send e-mail
        generateQR(
          docs[i].supplier[0].IBAN,
          docs[i].totalCost,
          docs[i].buyer[0].displayName,
          docs[i].supplier[0].displayName,
          function (qrcode) {
            // Send e-mail to each user with past due invoice
            const subject = `Faktura po splatnosti v Lednici IT!`
            //const body = `<header><h1>Okamžitě uhradit!</h1></header><section><article><p>Prosím o uhrazení faktury ze dne ${docs[i].invoiceDate} dodavateli ${docs[i].supplier[0].displayName} na IBAN ${docs[i].supplier[0].IBAN} v částce ${docs[i].totalCost}.</p><p>S pozdravem, Vaše Lednice IT.</p><p><img width="480" height="480" style="width: 20rem; height: 20rem;" alt="QR kód pro mobilní platbu se Vám nezobrazuje správně." src="${qrcode}"/></p></article></section>`
            const body = 'productPurchased'

            sendMail(
              docs[i].buyer[0].email,
              subject,
              body,
              'images/aloe-vera.png'
            )
          }
        )
      }
    })
    .catch((err) => {
      console.log(err)
    })
})

export default dailyReport
