import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the chart redraw bench in Chromium: `npm run bench:chart`. Kept apart from the e2e
 * suite so CI never runs it. Headless Chromium draws the 2D canvas on the CPU, so it reads
 * high; open /bench/chart/ on the laptop for the real numbers.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'chart.bench.ts',
  timeout: 120_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5197', viewport: { width: 1920, height: 1080 } },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
        },
      },
    },
  ],
  webServer: {
    command: 'npx vite --port 5197 --strictPort',
    cwd: '../..',
    url: 'http://localhost:5197',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
