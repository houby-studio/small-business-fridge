import { defineConfig, devices } from '@playwright/test'
import { getTestRuntimeEnv } from './tests/utils/test_db.js'

const E2E_PORT = '3345'
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`
const isCI = !!process.env.CI
const testEnv = getTestRuntimeEnv({
  PORT: E2E_PORT,
  APP_URL: E2E_BASE_URL,
})

/**
 * Playwright E2E test configuration.
 *
 * Runs against the app started in test mode (NODE_ENV=test, test DB).
 * The app is started automatically before tests and stopped after.
 *
 * To run: npx playwright test
 * To run with UI: npx playwright test --ui
 * To run specific file: npx playwright test tests/e2e/auth.spec.ts
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global_setup.ts',
  fullyParallel: false, // Avoid DB conflicts between parallel tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit-e2e.xml' }]],
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
    command: 'node ace serve --hmr',
    url: E2E_BASE_URL,
    // Always use a Playwright-managed server to avoid attaching to a stale local process.
    reuseExistingServer: false,
    env: testEnv,
  },

  projects: [
    isCI
      ? { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
      : { name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
})
