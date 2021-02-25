var nodemailer = require('nodemailer')

module.exports = {

  // Sends e-mail. Most parameters taken from ENV. Function takes recipient, subject, body and optional one image.
  // Example: sendMail('james.jameson@example.com', 'Hello there', '<p>Some lengthy message</p>', './images/logo.png')
  sendMail: function (mailto, mailsubject, mailbody, image) {
    // In case system error occurs, send warning to mail obtained from config.
    if (mailto === 'system') {
      mailto = process.env.MAIL_SYSTEM
    }

    var transporter = nodemailer.createTransport({
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
      mailOptions.attachments = [{
        path: `./public/${image}`,
        cid: 'image@prdelka.eu'
      }]
    }

    transporter.sendMail(mailOptions, function (error, info) {
      if (error) console.log(error)
    })
  }

}
