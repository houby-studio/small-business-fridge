var nodemailer = require('nodemailer');
var config = require('../config/config');

module.exports = {

    sendMail: function(mailto, mailsubject, mailbody, image, qrcode) {
        // In case system error occurs, send warning to mail obtained from config.
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
                path: `./public/${image}`,
                cid: 'image@prdelka.eu'
            }];
        }

        if (qrcode) {
            mailOptions.attachments = [{
                //https://qr-platba.cz/pro-vyvojare/specifikace-formatu/
                //https://www.npmjs.com/package/branded-qr-code
                //https://www.npmjs.com/package/qrcode
                path: 'qr_api',
                cid: 'image@prdelka.eu'
            }];
        }
        
        transporter.sendMail(mailOptions, function(error, info){
            if (error) {
                console.log(error);
            }
        });
    }

}