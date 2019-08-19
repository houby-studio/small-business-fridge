var nodemailer = require('nodemailer');
var config = require('../config/config');

module.exports = {

    sendMail: function(mailto, mailsubject, mailbody) {
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
            subject: 'Sending Email using Node.js',
            text: 'That was easy!'
        };
        
        transporter.sendMail(mailOptions, function(error, info){
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent: ' + info.response);
            }
        });
    }

}