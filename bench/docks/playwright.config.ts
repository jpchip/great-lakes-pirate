import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the docks district bench (plan 08 §14, §20.3 criterion 10) in Chromium: `npm run bench:docks`. Kept apart from the
 * e2e suite so CI never runs it. Headless Chromium renders with SwiftShader on the CPU,
 * so its frame times say little; draw calls, triangles and navmesh query cost are the point.
 * Run the page on the laptop for real frame times.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'docks.bench.ts',
  timeout: 900_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5197', viewport: { width: 1280, height: 720 } },
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
    command: 'npx vite --port 5197 --strictPort',
    // The repo root, so Vite serves the baked zone from public/.
    cwd: '../..',
    url: 'http://localhost:5197',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
