import QRCode from 'qrcode'

export default class QrPaymentService {
  /**
   * Generate a Czech SPD QR payment code.
   * SPD format: SPD*1.0*ACC:{IBAN}*AM:{amount}*CC:CZK*RN:{receiver}*MSG:{message}
   */
  async generate(options: {
    iban: string
    amount: number
    receiverName: string
    payerName: string
  }): Promise<{ imageData: string; code: string }> {
    const message = this.sanitize(`LEDNICE IT - ${options.payerName}`).substring(0, 60)
    const receiverName = this.sanitize(options.receiverName).substring(0, 35)

    const code = [
      'SPD*1.0',
      `ACC:${options.iban}`,
      `AM:${options.amount.toFixed(2)}`,
      'CC:CZK',
      `RN:${receiverName}`,
      `MSG:${message}`,
    ].join('*')

    const imageData = await QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      margin: 2,
      width: 300,
    })

    return { imageData, code }
  }

  /**
   * Remove diacritics and convert to uppercase for QR alphanumeric mode.
   */
  private sanitize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
  }
}
