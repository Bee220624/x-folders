import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // One browser with the extension loaded per test; they must not share state.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
