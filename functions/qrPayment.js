var qrcode = require('qrcode')

module.exports = function (IBAN, ammount, date, payer, receiver, callback) {
  if (!IBAN) {
    return callback()
  } else if (!ammount) {
    return callback()
  } else if (!date) {
    return callback()
  } else if (!payer) {
    return callback()
  }
  var msgTemplate = 'LEDNICE IT - '
  // MSG max length is 60 characters
  if ((payer.length + msgTemplate.length) > 60) {
    payer.substring(0, 60)
  }

  // Put together QRCode payment string, remove special characters and convert to uppercase to make QRCode ALPHANUMERIC only to reduce size
  var code = `SPD*1.0*ACC:${IBAN}*AM:${ammount}*CC:CZK*RN:${receiver}*MSG:${msgTemplate}${payer}`
  code = code.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

  qrcode.toDataURL(code, function (_err, url) {
    return callback(url)
  })
}
