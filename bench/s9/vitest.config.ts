import { defineConfig } from 'vitest/config';

// Spike S9 report (plan 04 §20): `npm run bench:weather`. Not part of `npm test`.
export default defineConfig({
  test: {
    include: ['bench/s9/*.report.ts'],
    environment: 'node',
    testTimeout: 300_000,
    silent: false,
  },
});
