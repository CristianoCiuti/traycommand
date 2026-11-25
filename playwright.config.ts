import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  workers: 1,
  // scripts run by the app start PowerShell: on a busy machine or a cold CI runner they take more than the default 5 s
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
