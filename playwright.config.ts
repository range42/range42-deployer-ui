/**
 * Root Playwright config. Delegates testDir to `./e2e` so the default
 * `npx playwright test` invocation (and the `npm run test:e2e` script)
 * both discover the E2E flows added in Plan C §C6.
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = Number.parseInt(process.env.VITE_DEV_PORT || '5173', 10)
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `VITE_DEV_PORT=${PORT} npm run dev`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_DEV_PORT: String(PORT),
      VITE_API_URL: process.env.VITE_API_URL || `http://localhost:${PORT}`,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
