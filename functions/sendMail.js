import { createTransport } from 'nodemailer'
import logger from './logger.js'

export function sendMail(mailto, mailsubject, mailbody, image) {
  // In case mail is destined for system administrator or we run in development environment, send all e-mails to system address obtained from config.
  if (process.env.NODE_ENV === 'development' || mailto === 'system@system') {
    logger.warn(
      `server.functions.sendmail__Sending e-mail [${mailsubject}] to system administrator.`
    )
    mailto = process.env.MAIL_SYSTEM || 'root@localhost'
  }

  var transporter = createTransport({
    port: process.env.MAIL_PORT,
    host: process.env.MAIL_HOST,
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  })

  var mailOptions = {
    from: {
      name: process.env.MAIL_FROM,
      address: process.env.MAIL_USERNAME
    },
    to: mailto,
    subject: mailsubject,
    html: mailbody
  }

  if (image) {
    mailOptions.attachments = [
      {
        path: `./public/${image}`,
        cid: 'image@prdelka.eu'
      }
    ]
  }

  transporter
    .sendMail(mailOptions)
    .then((info) => {
      logger.info(
        `server.functions.sendmail__Succesfully sent e-mail [${JSON.stringify(
          mailOptions
        )}].`,
        info
      )
    })
    .catch((err) => {
      logger.error(
        `server.functions.sendmail__Failed to send e-mail [${JSON.stringify(
          mailOptions
        )}]. Error:`,
        err
      )
    })
}
