import { toDataURL } from 'qrcode'
import logger from './logger.js'

export function generateQR (IBAN, amount, payer, receiver, callback) {
  if (!IBAN) {
    return callback()
  } else if (!amount) {
    return callback()
  } else if (!payer) {
    return callback()
  }
  const msgTemplate = 'LEDNICE IT - '
  // MSG max length is 60 characters
  if (payer.length + msgTemplate.length > 60) {
    logger.info(
      `server.functions.qrpayment__Message for customer [${payer}] exceeds 60 characters, trimming.`
    )
    payer.substring(0, 60)
  }

  logger.info(
    `server.functions.qrpayment__Generating a QR code customer:[${payer}]>supplier:[${receiver}]=amount:[${amount}].`
  )
  // Put together QRCode payment string, remove special characters and convert to uppercase to make QRCode ALPHANUMERIC only to reduce size
  let code = `SPD*1.0*ACC:${IBAN}*AM:${amount}*CC:CZK*RN:${receiver}*MSG:${msgTemplate}${payer}`
  code = code
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  toDataURL(code)
    .then((imageData) => {
      logger.info(
        `server.functions.qrpayment__Succesfully generated QR code customer:[${payer}]>supplier:[${receiver}]=amount:[${amount}].`
      )
      return callback(imageData, code)
    })
    .catch((err) => {
      logger.error(
        'server.functions.qrpayment__Failed to generate QR code.',
        err
      )
    })
}
