import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Layer import rules from plan 01 §6.
const noThree = {
  group: ['three', 'three/*'],
  message: 'sim/ and core/ must stay free of three.js (plan 01 §3).',
};
const noUpperLayers = (...layers) =>
  layers.map((layer) => ({
    group: [`**/${layer}/**`, `**/${layer}`],
    message: `This layer may not import from ${layer}/ (plan 01 §6).`,
  }));

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'raw-assets/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noThree,
            ...noUpperLayers('gameplay', 'render', 'modes', 'ui', 'audio', 'debug'),
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use core/rng (seeded) in sim/ (plan 01 §8).',
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noThree,
            ...noUpperLayers('sim', 'gameplay', 'render', 'modes', 'ui', 'audio', 'debug'),
          ],
        },
      ],
    },
  },
  {
    // render/ and ui/ read sim/ state but never mutate it; enforced by review for now.
    files: ['src/render/**/*.ts', 'src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: noUpperLayers('debug') }],
    },
  },
  prettier,
);
