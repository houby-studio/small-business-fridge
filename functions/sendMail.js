var nodemailer = require('nodemailer');
var config = require('../config/config');

module.exports = {

    sendMail: function(mailto, mailsubject, mailbody, image) {
        // In case system error occurs, send warning to mail from config.
        if (mailto == 'system') { mailto = config.mail.systemMail; }

        var transporter = nodemailer.createTransport({
            port: config.mail.port,
            host: config.mail.host,
            tls: {
                rejectUnauthorized: false
            },
        });
          
        var mailOptions = {
            from: config.mail.from,
            to: mailto,
            subject: mailsubject,
            html: mailbody
        };

        if (image) {
            mailOptions.attachments = [{
                path: image,
                cid: 'image@prdelka.eu' //same cid value as in the html img src
            }];
        }
        
        transporter.sendMail(mailOptions, function(error, info){
            if (error) {
                console.log(error);
            } else {
                //console.log('Email sent: ' + info.response);
            }
        });
    }

}