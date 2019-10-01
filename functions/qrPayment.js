var qrcode = require('qrcode');

module.exports =  function(IBAN, ammount, date, payer, callback) {
        if (!IBAN) {
            console.log('Did not receive IBAN');
            return null;
        } else if (!ammount) {
            console.log('Did not receive ammount');
            return null;
        } else if (!date) {
            console.log('Did not receive date');
            return null;
        } else if (!payer) {
            console.log('Did not receive payer');
            return null;
        }
        console.log('got there');
        var msgTemplate = 'LedniceIT - ';
        // MSG max length is 60 characters
        if ((payer.length + msgTemplate.length) > 60) {
            payer.substring(0, 60);
        }

        // Crazy ugly QR code string
        var code = `SPD*1.0*ACC:${IBAN}*AM:${ammount}*CC:CZK*MSG:${msgTemplate}${payer}`;

        qrcode.toDataURL(code, function (err, url) {
            return callback(url);
        });
}