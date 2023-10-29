import { RecurrenceRule, Range, scheduleJob } from 'node-schedule'
import { sendMail } from '../functions/sendMail.js'
import { generateQR } from '../functions/qrPayment.js'
import moment from 'moment'
import Invoice from '../models/invoice.js'
import logger from '../functions/logger.js'
moment.locale('cs')

// Schedule rule - should read weekday start and end day + report send hour and minute from ENV
var rule = new RecurrenceRule()
rule.hour = process.env.TASKS_DAILY_INCOMPLETE_INVOICE_HOUR
rule.minute = process.env.TASKS_DAILY_INCOMPLETE_INVOICE_MINUTE

var scheduledTask = scheduleJob(rule, function () {
  // This schedule can be disabled in the ENV
  if (!process.env.TASKS_DAILY_INCOMPLETE_INVOICE_ENABLED) {
    return
  }

  logger.info(
    `server.tasks.dailyunpaidinvoicesnotice__Started scheduled task to find unpaid invoices and send notices.`
  )

  // Get date from process.env.TASKS_DAILY_INCOMPLETE_INVOICE_NET_DAYS days ago
  const dateAgo = new Date(
    Date.now() -
      86400 * 1000 * (process.env.TASKS_DAILY_INCOMPLETE_INVOICE_NET_DAYS || 14)
  )
  const daysAgo = new Date(
    dateAgo.getFullYear(),
    dateAgo.getMonth(),
    dateAgo.getDate()
  )

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
        `server.tasks.dailyunpaidinvoicesnotice__Successfully loaded ${docs.length} past due invoices.`,
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
              `server.tasks.dailyunpaidinvoicesnotice__Successfully incremented autoReminderCount:[${result.autoReminderCount}] on invoice:[${docs[i]._id}].`,
              {
                metadata: {
                  result: result
                }
              }
            )

            // Generate QR code and send e-mail
            generateQR(
              docs[i].supplier[0].IBAN,
              docs[i].totalCost,
              docs[i].buyer[0].displayName,
              docs[i].supplier[0].displayName,
              function (qrImageData, qrText) {
                // Send e-mail to each user with past due invoice
                // Sum of both automatic and manual notices sent. Manual may be non-existent
                const noticeCount =
                  result.autoReminderCount +
                  (docs[i].manualReminderCount || 0) +
                  1
                const subject = `${noticeCount}. výzva k úhradě faktury po splatnosti`
                const mailPreview = `Částka k úhradě ${docs[i].totalCost} Kč.`

                sendMail(docs[i].buyer[0].email, 'dailyUnpaidInvoiceNotice', {
                  subject,
                  mailPreview,
                  invoiceId: docs[i]._id,
                  invoiceDate: moment(docs[i].invoiceDate).format('LLLL'),
                  invoiceTotalCost: docs[i].totalCost,
                  noticeCount: noticeCount,
                  supplierDisplayName: docs[i].supplier[0].displayName,
                  supplierIBAN: docs[i].supplier[0].IBAN,
                  customerDisplayName: docs[i].buyer[0].displayName,
                  qrImageData,
                  qrText
                })
              }
            )
          })
          .catch((err) => {
            logger.error(
              `server.tasks.dailyunpaidinvoicesnotice__Failed to increment autoReminderCount:[${result.autoReminderCount}] on invoice:[${docs[i]._id}].`,
              {
                metadata: {
                  error: err.message
                }
              }
            )
          })
      }
    })
    .catch((err) => {
      logger.error(
        `server.tasks.dailyunpaidinvoicesnotice__Failed to load past due invoices.`,
        {
          metadata: {
            error: err.message
          }
        }
      )
    })
})

export default scheduledTask
