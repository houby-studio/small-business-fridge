import { defineConfig, devices } from '@playwright/test'

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

  use: {
    baseURL: 'http://localhost:3334',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'cs-CZ', // Force Czech locale so the app renders in Czech (Vše, Koupit, etc.)
  },

  /* Start the AdonisJS server in test mode before running E2E tests */
  webServer: {
    command: 'node ace serve --no-hmr',
    url: 'http://localhost:3334',
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test',
      PORT: '3334',
      HOST: 'localhost',
      SESSION_DRIVER: 'memory',
      LOG_LEVEL: 'error',
      APP_KEY: 'test-app-key-for-testing-only-123',
      DB_HOST: '127.0.0.1',
      DB_PORT: '5433',
      DB_USER: 'sbf',
      DB_PASSWORD: 'sbf',
      DB_DATABASE: 'sbf_test',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1026',
      SMTP_USERNAME: '',
      SMTP_PASSWORD: '',
      SMTP_FROM_ADDRESS: 'noreply@test.local',
      SMTP_FROM_NAME: 'Test',
      OIDC_ENABLED: 'false',
      API_SECRET: 'test-api-secret',
      APP_URL: 'http://localhost:3334',
    },
  },

  projects: [
    {
      name: 'msedge',
      use: { ...devices['Desktop Edge'] },
    },
  ],
})
