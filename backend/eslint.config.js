/**
 * The backend's own ESLint config.
 *
 * Without this file ESLint walks up to the repository root and finds a
 * browser/React flat config built against typescript-eslint v8, which needs
 * ESLint 9 — while `backend/` resolves ESLint 8.57 locally. The result was that
 * `npm run lint` crashed instead of linting, and backend source had never been
 * linted at all.
 *
 * Flat config (8.57 supports it) and CommonJS, because `backend/package.json`
 * declares no `"type": "module"`.
 */

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

module.exports = [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'migrations/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      // Node, not a browser. Inheriting the root's `globals.browser` is why
      // `process`, `__dirname` and `Buffer` read as undefined here.
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // An unused argument prefixed with `_` is a deliberate signal, and Express
      // is full of them: `(_req, res)`. Express also identifies an error handler
      // by its arity, so a fourth parameter has to stay whether the body names
      // it or not.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          // `const { keyHash, ...rest } = apiKey` is how the API-key routes drop
          // the hash before responding. The discarded binding is the point of
          // the line, not an oversight.
          ignoreRestSiblings: true,
        },
      ],

      // 176 occurrences, 159 of them in the two database adapters, which are
      // duck-typed against `pg` and `better-sqlite3` row shapes. Typing those
      // properly is a real piece of work and not something to do in the same
      // change that turns linting on for the first time.
      //
      // Left as a warning rather than switched off: `npm run lint` has to be
      // able to pass, or it gets ignored the way the e2e job did while it ran
      // with `continue-on-error`. The count is the backlog.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Specs run under Vitest with `globals: true`, so the test API is ambient.
    files: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
];
