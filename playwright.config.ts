import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', testMatch: '**/*.spec.ts', workers: 1, timeout: 30000,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3016', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: 'npm run preview -- --host 0.0.0.0 --port 3016', url: 'http://127.0.0.1:3016', reuseExistingServer: false },
});
