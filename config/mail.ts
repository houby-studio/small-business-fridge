import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'

const smtpUsername = env.get('SMTP_USERNAME')
const smtpPassword = env.get('SMTP_PASSWORD')
const hasSmtpAuth = Boolean(smtpUsername && smtpPassword)

const mailConfig = defineConfig({
  default: 'smtp',

  /**
   * A static address for the "from" property. It will be
   * used when not explicitly set on the Email
   */
  from: {
    address: env.get('SMTP_FROM_ADDRESS', 'noreply@lednice.it'),
    name: env.get('SMTP_FROM_NAME', env.get('APP_NAME', 'Small Business Fridge')),
  },

  /**
   * The mailers object can be used to configure multiple mailers
   * each using a different transport driver.
   */
  mailers: {
    smtp: transports.smtp({
      ...(hasSmtpAuth
        ? {
            auth: {
              type: 'login',
              user: smtpUsername!,
              pass: smtpPassword!,
            },
          }
        : {}),
      host: env.get('SMTP_HOST'),
      port: env.get('SMTP_PORT'),
      ...(env.get('SMTP_IGNORE_TLS')
        ? { ignoreTLS: true, tls: { rejectUnauthorized: false } }
        : {}),
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
