#!/usr/bin/env node
/* eslint-disable no-fallthrough */

/**
 * Module dependencies.
 */

import app from '../app.js'
import debug from 'debug'
import { createServer } from 'http'
import logger from '../functions/logger.js'
const defaultLogger = debug('small-bussiness-fridge:server')

/**
 * Get port from environment and store in Express.
 */

const port = normalizePort(process.env.APP_PORT || '3000')
app.set('port', port)

/**
 * Create HTTP server.
 */

const server = createServer(app)

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port)
server.on('error', onError)
server.on('listening', onListening)

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
  const port = parseInt(val, 10)

  if (isNaN(port)) {
    // named pipe
    return val
  }

  if (port >= 0) {
    // port number
    return port
  }

  return false
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error
  }

  const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges')
      logger.error(
        'server.www.startup__Specified port requires elevated privileges.'
      )
      process.exit(1)
    case 'EADDRINUSE':
      console.error(bind + ' is already in use')
      logger.error('server.www.startup__Specified port is already in use.')
      process.exit(1)
    default:
      throw error
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  const addr = server.address()
  const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port
  defaultLogger('Listening on ' + bind)
  logger.info(`server.www.startup__HTTP server listening on port ${port}`)
}
