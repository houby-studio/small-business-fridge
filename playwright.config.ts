import { defineConfig, devices } from '@playwright/test'
import { getTestRuntimeEnv } from './tests/utils/test_db.js'

const E2E_PORT = '3345'
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`
const testEnv = getTestRuntimeEnv({
  PORT: E2E_PORT,
  APP_URL: E2E_BASE_URL,
  // Lets the product form offer contributing to Open Food Facts. Nothing is ever sent:
  // contributions go out from the scheduler, which the e2e server does not run.
  PRODUCT_IMAGE_OPENFOODFACTS_USER: 'fridgora-e2e',
  PRODUCT_IMAGE_OPENFOODFACTS_PASSWORD: 'e2e',
})

/**
 * Playwright E2E test configuration.
 *
 * Runs against the app started in test mode (NODE_ENV=test, test DB).
 * The app is started automatically before tests and stopped after.
 *
 * To run: npm run test:e2e
 * To run with UI: npm run test:e2e -- --ui
 * To run specific file: npm run test:e2e -- tests/e2e/auth.spec.ts
 * To run one CI shard: npm run test:e2e -- --shard=2/6
 */
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['auth_env_matrix.spec.ts'],
  globalSetup: './tests/e2e/global_setup.ts',
  // One worker, because every test shares one database. fullyParallel only lets `--shard` split
  // per test instead of per file: CI runs the suite as several jobs, each with its own database,
  // and admin_pages.spec.ts alone would otherwise pin one shard for ~90 s. That is safe because
  // no test depends on another (verified by running 4 and 6 shards against fresh databases).
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/junit-e2e.xml' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  // Separate artifact dir from test-results/ so Playwright's startup cleanup
  // does not delete the Japa JUnit XML that was written before E2E runs.
  outputDir: 'playwright-artifacts',

  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'cs-CZ', // Force Czech locale so the app renders in Czech (Vše, Koupit, etc.)
  },

  /* Start the AdonisJS server in test mode before running E2E tests */
  webServer: {
    command: 'cd build && node bin/server.js',
    url: E2E_BASE_URL,
    // Always use a Playwright-managed server to avoid attaching to a stale local process.
    reuseExistingServer: false,
    env: testEnv,
    timeout: 120 * 1000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
