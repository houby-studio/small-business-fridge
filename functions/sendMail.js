import { createTransport } from 'nodemailer'
import hbs from 'nodemailer-express-handlebars'
import logger from './logger.js'

export function sendMail(mailto, template, context, image) {
  // In case mail is destined for system administrator or we run in development environment, send all e-mails to system address obtained from config.
  if (
    mailto === 'system@system' ||
    (process.env.NODE_ENV.toLowerCase() === 'development' &&
      process.env.MAIL_DEV_SYSTEM.toLowerCase() === 'true')
  ) {
    logger.warn(
      `server.functions.sendmail__Sending e-mail [${context.subject}] to system administrator.`,
      {
        metadata: {
          mailto,
          nodeEnv: process.env.NODE_ENV,
          mailDevSystem: process.env.MAIL_DEV_SYSTEM
        }
      }
    )
    mailto = process.env.MAIL_SYSTEM || 'root@localhost'
  }

  const transporter = createTransport({
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
  const options = {
    viewEngine: {
      layoutsDir: 'views/email',
      partialsDir: 'views/email/partials',
      defaultLayout: 'layout'
    },
    viewPath: 'views/email'
  }
  transporter.use('compile', hbs(options))

  context.baseUrl = process.env.MAIL_BASE_URL || 'https://localhost'

  const mailOptions = {
    from: {
      name: process.env.MAIL_FROM,
      address: process.env.MAIL_USERNAME
    },
    to: mailto,
    subject: context.subject,
    template,
    context
  }

  mailOptions.attachments = [
    {
      path: './public/static_images/logo.png',
      cid: 'logo@sbf.pictures'
    }
  ]
  if (image) {
    mailOptions.attachments.push({
      path: `./public/${image}`,
      cid: 'image@sbf.pictures'
    })
  }

  transporter
    .sendMail(mailOptions)
    .then((result) => {
      logger.info(
        `server.functions.sendmail__Succesfully sent e-mail [${context.subject}].`,
        {
          metadata: {
            result,
            mailOptions
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
            mailOptions
          }
        }
      )
    })
}
