import { defineConfig } from 'vitest/config';

// The economy balance harness, long runs (plan 17 §3, plan 05 §16.3 criteria 2–4):
// `npm run bench:economy`. Not part of `npm test`; the short runs are there.
export default defineConfig({
  test: {
    include: ['bench/economy/*.report.ts'],
    environment: 'node',
    testTimeout: 600_000,
    silent: false,
  },
});
