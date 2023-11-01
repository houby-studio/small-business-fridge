import { RecurrenceRule, scheduleJob } from 'node-schedule'
import { sendMail } from '../functions/sendMail.js'
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
    `server.tasks.dailypaidinvoicesneedsapproval__Started scheduled task to find paid invoices without supplier confirmation and send notices.`
  )

  // Aggregate paid invoices without supplier confirmation
  Invoice.aggregate([
    {
      $match: {
        $and: [{ paid: false }, { requestPaid: true }]
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
        `server.tasks.dailypaidinvoicesneedsapproval__Successfully loaded ${docs.length} invoices with payment confirmation request.`,
        {
          metadata: {
            result: docs
          }
        }
      )
      for (let i = 0; i < docs.length; i++) {
        const subject = 'Zkontrolujte a potvrďte platbu faktury'
        const mailPreview = `Zákazník ${docs[i].buyer[0].displayName} označil fakturu v celkové hodnotě ${docs[i].totalCost} Kč za uhrazenou.`

        sendMail(docs[i].supplier[0].email, 'dailyPaidInvoiceNeedsApproval', {
          subject,
          mailPreview,
          invoiceId: docs[i]._id,
          invoiceDate: moment(docs[i].invoiceDate).format('LLLL'),
          invoiceTotalCost: docs[i].totalCost,
          supplierDisplayName: docs[i].supplier[0].displayName,
          supplierIBAN: docs[i].supplier[0].IBAN,
          customerDisplayName: docs[i].buyer[0].displayName
        })
      }
    })
    .catch((err) => {
      logger.error(
        `server.tasks.dailypaidinvoicesneedsapproval__Failed to load past due invoices.`,
        {
          metadata: {
            error: err.message
          }
        }
      )
    })
})

export default scheduledTask
