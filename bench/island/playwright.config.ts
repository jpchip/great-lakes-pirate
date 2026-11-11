import { defineConfig, devices } from '@playwright/test';

/**
 * Runs bench.island (plan 08 §20.3 criterion 10) in Chromium: `npm run bench:island`. Kept apart
 * from the e2e suite so CI never runs it. Headless Chromium renders on the CPU, so its frame
 * times say little; draw calls and triangles are the point. Run the page on the laptop for
 * real frame times.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'island.bench.ts',
  timeout: 900_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5198', viewport: { width: 1280, height: 720 } },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
          ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
        },
      },
    },
  ],
  webServer: {
    command: 'npx vite --port 5198 --strictPort',
    cwd: '../..',
    url: 'http://localhost:5198',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
