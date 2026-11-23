import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Several journeys sign in more than once and the dev server compiles pages on first use, so the
  // 30 s default is too tight on a slow machine; a test that needs more sets its own.
  timeout: 60_000,
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
})
