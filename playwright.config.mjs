import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/konsulttimer/',
    ...devices['Pixel 7'], // mobilstorlek (Chromium)
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    acceptDownloads: true,
  },
  webServer: {
    command: 'node scripts/serve.mjs --port 4173',
    url: 'http://localhost:4173/konsulttimer/',
    reuseExistingServer: !process.env.CI,
  },
});
