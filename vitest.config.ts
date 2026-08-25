import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Only the frontend lives here. backend/ has its own vitest config and node
    // environment — running those specs under jsdom from the root both misconfigures
    // them and inflates this project's numbers. e2e/ holds Playwright specs, which
    // use their own runner and throw if collected here (`npm run test:e2e`).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'backend/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Count every source file, not only the ones a test happened to import —
      // the same correction made in backend/vitest.config.ts. Without it the
      // denominator moves with the test selection, and adding a test that pulls
      // in a large untested module looks like a regression when nothing changed.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        // The specs themselves are not the subject under measurement; leaving
        // them in counts every test file as 100% covered source and flatters
        // the average by exactly as much as you write tests.
        '**/*.{test,spec}.{ts,tsx}',
      ],
      /**
       * Floors, not targets. Each sits just under what the suite achieves
       * today, so the build fails when coverage *drops* rather than nagging
       * about screens that were never covered to begin with. Raise them as the
       * real number climbs; that is the ratchet working.
       *
       * Without these, `test:coverage` in CI produced a number, uploaded it as
       * an artefact, and could never fail — coverage could fall to nothing and
       * the build would stay green.
       *
       * The global functions floor is much lower than the others on purpose.
       * `all: true` counts every file, and `src/lib/api` is a large surface of
       * one-line SDK wrappers, most of which no unit test calls directly even
       * though the pages that use them are covered. Holding that number to the
       * statement level would mean writing tests that assert a wrapper passes
       * its arguments along.
       *
       * A glob-matched file is checked against its glob *and* still counts
       * toward the global figure, so the globals stay a whole-project floor.
       *
       * Every number here was checked by raising it until the run failed, then
       * setting it back. A gate nobody has watched fail is not a gate.
       */
      thresholds: {
        statements: 64,
        branches: 75,
        functions: 36,
        lines: 64,

        /**
         * The pure logic behind the register: change due, permission checks,
         * barcode encoding, report windows, and who an action is attributed
         * to. All at 100% today, all cheap to keep there, and each one wrong
         * is a wrong number on a receipt or a door opened to the wrong person.
         */
        'src/lib/register-math.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/permissions.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/code39.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/audit-actor.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/lib/report-range.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },

        // The transport every page depends on, and the export path that has
        // shipped a silent failure before.
        'src/lib/api-client.ts': { statements: 87, branches: 92, functions: 86, lines: 87 },
        'src/lib/export-core.ts': { statements: 93, branches: 91, functions: 78, lines: 93 },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

