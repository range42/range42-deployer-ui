import { defineConfig, devices } from '@playwright/test'

// Align the dev server port with Playwright's expected base URL so both
// webServer lifecycle and page.goto('/') hit the same origin. Use 5173 by
// default (Vite's historic dev port) — override via PLAYWRIGHT_TEST_BASE_URL
// and VITE_DEV_PORT if the host has a conflict.
const PORT = Number.parseInt(process.env.VITE_DEV_PORT || '5173', 10)
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './',
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
      // Point /v1/* proxy at the mock when provided; tests rely on
      // page.route interception, so the actual URL rarely matters.
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
