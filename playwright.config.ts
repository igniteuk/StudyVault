import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/browser',
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['json', { outputFile: 'quality/.work/browser.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: process.env.STUDYVAULT_BROWSER || undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    timeout: 30_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
})
