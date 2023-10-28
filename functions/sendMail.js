import { createTransport } from 'nodemailer'
import hbs from 'nodemailer-express-handlebars'
import logger from './logger.js'

export function sendMail(mailto, template, context, image) {
  // In case mail is destined for system administrator or we run in development environment, send all e-mails to system address obtained from config.
  if (
    mailto === 'system@system' ||
    (process.env.NODE_ENV === 'development' &&
      process.env.MAIL_DEV_SYSTEM === 'true')
  ) {
    logger.warn(
      `server.functions.sendmail__Sending e-mail [${context.subject}] to system administrator.`,
      {
        metadata: {
          mailto: mailto,
          nodeEnv: process.env.NODE_ENV,
          mailDevSystem: process.env.MAIL_DEV_SYSTEM
        }
      }
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

  // Configure templates
  var options = {
    viewEngine: {
      layoutsDir: 'views/email',
      partialsDir: 'views/email/partials',
      defaultLayout: 'layout'
    },
    viewPath: 'views/email'
  }
  transporter.use('compile', hbs(options))

  context.baseUrl = process.env.MAIL_BASE_URL || 'https://localhost'

  var mailOptions = {
    from: {
      name: process.env.MAIL_FROM,
      address: process.env.MAIL_USERNAME
    },
    to: mailto,
    subject: context.subject,
    template: template,
    context: context
  }

  if (image) {
    mailOptions.attachments = [
      {
        path: `./public/${image}`,
        cid: 'image@sbf.pictures'
      }
    ]
  }

  transporter
    .sendMail(mailOptions)
    .then((result) => {
      logger.info(
        `server.functions.sendmail__Succesfully sent e-mail [${context.subject}].`,
        {
          metadata: {
            result: result,
            mailOptions: mailOptions
          }
        }
      )
    })
    .catch((err) => {
      logger.error(
        `server.functions.sendmail__Failed to send e-mail [${context.subject}].`,
        {
          metadata: {
            error: err.message,
            mailOptions: mailOptions
          }
        }
      )
    })
}
