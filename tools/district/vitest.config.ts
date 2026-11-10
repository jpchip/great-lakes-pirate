import { defineConfig } from 'vitest/config';

// The district bake (plan 08 §5.3; Phase 7 piece C): `npm run district:bake`, or
// `DISTRICT=bayfield npm run district:bake` for one. Run through vitest so it can import
// the game's own modules as they are; it is not part of `npm test`.
export default defineConfig({
  test: {
    include: ['tools/district/bake.run.ts'],
    environment: 'node',
    testTimeout: 600_000,
    silent: false,
  },
});
