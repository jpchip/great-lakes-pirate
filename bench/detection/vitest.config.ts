import { defineConfig } from 'vitest/config';

// The detection bench (plan 06 §14.3 criterion 4, §14.4 piece B): `npm run bench:detection`.
// Not part of `npm test`; the short checks are in tests/detection.test.ts.
export default defineConfig({
  test: {
    include: ['bench/detection/*.report.ts'],
    environment: 'node',
    testTimeout: 120_000,
    silent: false,
  },
});
