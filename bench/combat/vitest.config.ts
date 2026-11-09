import { defineConfig } from 'vitest/config';

// The combat bench (plan 07 §14.3 criterion 5, Phase 6 piece H): `npm run bench:combat`.
// Not part of `npm test`; the short checks are in tests/combat.test.ts.
export default defineConfig({
  test: {
    include: ['bench/combat/*.report.ts'],
    environment: 'node',
    testTimeout: 120_000,
    silent: false,
  },
});
