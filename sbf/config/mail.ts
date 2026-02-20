import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'

const mailConfig = defineConfig({
  default: 'smtp',

  /**
   * A static address for the "from" property. It will be
   * used when not explicitly set on the Email
   */
  from: {
    address: env.get('SMTP_FROM_ADDRESS', 'noreply@lednice.it'),
    name: env.get('SMTP_FROM_NAME', 'Lednice IT'),
  },

  /**
   * The mailers object can be used to configure multiple mailers
   * each using a different transport driver.
   */
  mailers: {
    smtp: transports.smtp({
      host: env.get('SMTP_HOST'),
      port: env.get('SMTP_PORT'),
      ...(env.get('SMTP_IGNORE_TLS')
        ? { ignoreTLS: true, tls: { rejectUnauthorized: false } }
        : {}),
      auth: {
        type: 'login',
        user: env.get('SMTP_USERNAME', ''),
        pass: env.get('SMTP_PASSWORD', ''),
      },
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
