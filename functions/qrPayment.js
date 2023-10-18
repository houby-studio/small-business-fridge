import { toDataURL } from 'qrcode'
import logger from './logger.js'

export function generateQR(IBAN, amount, payer, receiver, callback) {
  if (!IBAN) {
    return callback()
  } else if (!amount) {
    return callback()
  } else if (!payer) {
    return callback()
  }
  var msgTemplate = 'LEDNICE IT - '
  // MSG max length is 60 characters
  if (payer.length + msgTemplate.length > 60) {
    logger.warn(
      `server.functions.qrpayment__Message for customer [${payer}] exceeds 60 characters, trimming.`
    )
    payer.substring(0, 60)
  }

  logger.info(
    `server.functions.qrpayment__Generating a code from the customer [${payer}] to the supplier [${receiver}] for the amount of [${amount}].`
  )
  // Put together QRCode payment string, remove special characters and convert to uppercase to make QRCode ALPHANUMERIC only to reduce size
  var code = `SPD*1.0*ACC:${IBAN}*AM:${amount}*CC:CZK*RN:${receiver}*MSG:${msgTemplate}${payer}`
  code = code
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  toDataURL(code)
    .then((url) => {
      logger.info(
        `server.functions.qrpayment__Succesfully generated QR code [${payer}]>[${receiver}]:[${amount}].`
      )
      return callback(url)
    })
    .catch((err) => {
      logger.error(
        `server.functions.qrpayment__Failed to generate QR code.`,
        err
      )
    })
}
