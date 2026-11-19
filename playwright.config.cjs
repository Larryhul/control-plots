const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.CONTROL_PLOTS_BASE_URL || 'http://127.0.0.1:4173/control-plots/';
const desktop = '**/desktop.spec.cjs';
const mobile = '**/mobile.spec.cjs';

module.exports = defineConfig({
  testDir: './e2e',
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', testMatch: desktop, use: devices['Desktop Chrome'] },
    { name: 'firefox', testMatch: desktop, use: devices['Desktop Firefox'] },
    { name: 'webkit', testMatch: desktop, use: devices['Desktop Safari'] },
    { name: 'android', testMatch: mobile, use: devices['Pixel 7'] },
    { name: 'iphone', testMatch: mobile, use: devices['iPhone 13'] },
  ],
  webServer: process.env.CONTROL_PLOTS_BASE_URL ? undefined : {
    command: 'node e2e/serve.cjs',
    url: baseURL,
    timeout: 15000,
  },
});
