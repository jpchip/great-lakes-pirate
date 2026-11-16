import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the hideout bench (plan 09 §10, §16.3 criterion 3) in Chromium: `npm run bench:hideout`. Kept apart from the
 * e2e suite so CI never runs it. Headless Chromium renders with SwiftShader on the CPU,
 * so its frame times say little; draw calls, triangles and placement cost are the point.
 * Run the page on the laptop for real frame times.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'hideout.bench.ts',
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
    // The repo root, so Vite serves the baked zone from public/.
    cwd: '../..',
    url: 'http://localhost:5198',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
