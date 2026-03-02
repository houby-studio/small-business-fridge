import { execSync } from 'node:child_process'

/**
 * Run migrations before starting the server
 * when the MIGRATE environment variable is set.
 */
if (process.env.DB_MIGRATE === 'true') {
  console.log('Running migrations...')
  execSync('node ace migration:run --force', { stdio: 'inherit' })
}

/**
 * Start the server
 */
console.log('Starting server...')
await import('./bin/server.js')
