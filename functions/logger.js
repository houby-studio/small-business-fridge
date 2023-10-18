import { createLogger, transports, format } from 'winston'
const { combine, timestamp, json, simple } = format

var logger = createLogger({
  transports: [
    new transports.File({
      format: combine(timestamp(), json()),
      level: 'info',
      filename: './logs/all-logs.json',
      handleExceptions: true,
      json: true,
      maxsize: 5242880, //5MB
      maxFiles: 14,
      colorize: false
    }),
    new transports.Console({
      format: simple(),
      level: 'debug',
      handleExceptions: true,
      json: false,
      colorize: true
    })
  ],
  exitOnError: false
})

logger.stream = {
  write: function (message, _encoding) {
    logger.info(message.replace(/(\n)/gm, ''))
  }
}
export default logger
