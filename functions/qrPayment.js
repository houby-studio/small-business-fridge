var qrcode = require(qrcode);
var config = require('../config/config');

module.exports = {

    generatePaymentQR: function(IBAN, ammount, date, payer) {
        if (!IBAN) {
            return null;
        } else if (!ammount) {
            return null;
        } else if (!date) {
            return null;
        } else if (!payer) {
            return null;
        }

        var msgTemplate = 'LedniceIT - ';
        // MSG max length is 60 characters
        if ((payer.length + msgTemplate.length) > 60) {
            payer.substring(0, 60);
        }

        // Crazy ugly QR code string
        var code = `SPD*1.0*ACC:${IBAN}*AM:${ammount}*CC:CZK*MSG:${msgTemplate}${payer}`;
        
        var result = await qrcode.toDataURL(code);
        return result;
    }

}