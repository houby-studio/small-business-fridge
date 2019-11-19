var nodemailer = require('nodemailer')
var config = require('../config/config')

module.exports = {

  // Sends e-mail. Most parameters taken from config. Function takes recipient, subject, body and optional one image.
  // Example: sendMail('james.jameson@example.com', 'Hello there', '<p>Some lengthy message</p>', './images/logo.png')
  sendMail: function (mailto, mailsubject, mailbody, image) {
    // In case system error occurs, send warning to mail obtained from config.
    if (mailto === 'system') {
      mailto = config.mail.systemMail
    }

    var transporter = nodemailer.createTransport({
      port: config.mail.port,
      host: config.mail.host,
      tls: {
        rejectUnauthorized: false
      }
    })

    var mailOptions = {
      from: config.mail.from,
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
