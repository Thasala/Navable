import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  // Prefer headful Chromium to avoid macOS headless_shell restrictions in CI
  use: { headless: false, trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], headless: false } }
  ],
  reporter: [['list']]
});
