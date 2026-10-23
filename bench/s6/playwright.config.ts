import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the S6 benchmark page in Chromium: `npm run bench:save`. Kept apart from the
 * e2e suite so CI never runs it. Its own port keeps it off the dev server's
 * IndexedDB origin, so it never touches a dev run.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 's6.bench.ts',
  timeout: 300_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5199' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
