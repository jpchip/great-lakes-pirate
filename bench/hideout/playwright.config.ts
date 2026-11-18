import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the hideout benches (plan 09 §10, §16.3 criteria 3 and 12) in Chromium: `npm run bench:hideout`. Kept apart from
 * the e2e suite so CI never runs it. Headless Chromium renders with SwiftShader on the CPU,
 * so its frame times say little; draw calls, triangles and placement cost are the point.
 * On the laptop, `GPU=1 npm run bench:hideout` opens a headed browser on the real GPU for
 * frame times.
 */
const gpu = Boolean(process.env.GPU);
export default defineConfig({
  testDir: '.',
  testMatch: '*.bench.ts',
  workers: 1,
  timeout: 900_000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5198', viewport: { width: 1280, height: 720 } },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        headless: !gpu,
        launchOptions: {
          args: gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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
