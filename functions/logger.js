import { createLogger, transports, format } from 'winston'
const { combine, timestamp, json } = format

var logger = createLogger({
  transports: [
    new transports.File({
      format: combine(timestamp(), json()),
      level: 'info',
      filename: './logs/all-logs.json',
      handleExceptions: true,
      json: true,
      maxsize: 5242880, //5MB
      maxFiles: '14d',
      colorize: false
    }),
    new transports.File({
      format: combine(timestamp(), json()),
      level: 'error',
      filename: './logs/error.json',
      handleExceptions: true,
      json: true,
      maxsize: 5242880, //5MB
      maxFiles: '14d',
      colorize: false
    }),
    new transports.Console({
      format: combine(
        format.colorize({ all: true }),
        timestamp({ format: 'YY-MM-DD HH:mm:ss' }),
        format.printf(
          (info) => `[${info.timestamp}] [${info.level}] : ${info.message}`
        )
      ),
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
