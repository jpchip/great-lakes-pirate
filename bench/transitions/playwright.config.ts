import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the transition bench in Chromium: `npm run bench:transitions`. Kept apart from the
 * e2e suite so CI never runs it. Headless Chromium renders with SwiftShader on the CPU and
 * compiles shaders slowly, so its times read high; run it on the laptop for the real
 * numbers (`PW_CHROMIUM_PATH` for a local Chrome, `HEADED=1` to watch).
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'transitions.bench.ts',
  timeout: 600_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4196',
    viewport: { width: 1600, height: 900 },
    headless: !process.env.HEADED,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        launchOptions: {
          args: [
            '--enable-precise-memory-info',
            '--js-flags=--expose-gc',
            ...(process.env.HEADED
              ? []
              : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
          ],
          ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
        },
      },
    },
  ],
  webServer: {
    // The production build, as players get it.
    command: 'npm run build && npx vite preview --port 4196 --strictPort',
    cwd: '../..',
    url: 'http://localhost:4196',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
