import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run tests on the clock production runs on.
    //
    // Postgres `TIMESTAMP WITHOUT TIME ZONE` carries no offset, and
    // node-postgres serialises and parses it using the *process* timezone. A
    // round trip cancels out on any host, but a client-written value compared
    // against one Postgres computed (NOW(), EXTRACT) does not — that is how a
    // register's hourly sales landed four hours out on a developer machine set
    // to America/New_York. Deployment pins TZ=UTC (see backend/Dockerfile and
    // docker-compose.yml); pinning it here too means a test either passes for
    // everyone or fails for everyone, rather than depending on where the person
    // running it happens to live.
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Count every source file, not only the ones a test happened to import.
      //
      // Without this the denominator moves with the test selection: a run that
      // never loaded `SQLiteAdapter.ts` simply left its 3,891 lines out and
      // reported a flattering average. Adding one test that imports `app`
      // pulled the file in and appeared to halve adapter coverage overnight,
      // when nothing had regressed at all.
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        'migrations/',
        'scripts/',
      ],
      /**
       * Floors, not targets. Each is set just under what the suite achieves
       * today, so the build fails when coverage *drops* rather than nagging
       * about code that was never covered in the first place. Raise them when
       * the real number moves up; that is the ratchet working.
       *
       * Two things about the global numbers, which look low:
       *
       * CI measures coverage with `test:coverage`, which **excludes** the
       * integration suites. `src/adapters/db` is covered almost entirely by
       * those, so it reports ~0.1% here — 4,000-odd lines of adapter dragging
       * the average down by construction, not by neglect. It is deliberately
       * not given a threshold of its own: a floor on a directory whose tests
       * do not run in this job would either be meaninglessly low or block on
       * something this job cannot see.
       *
       * The per-directory and per-file floors below are where the real signal
       * is. A glob-matched file is checked against its glob *and* still counts
       * toward the global figure — the two are not exclusive — so the global
       * numbers stay a whole-project floor rather than a remainder.
       *
       * Every threshold here was checked by raising it until the run failed,
       * then setting it back. A gate nobody has watched fail is not a gate.
       */
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 30,
        lines: 30,

        // The layers this job genuinely exercises.
        'src/api/middleware/**': { statements: 87, branches: 75, functions: 90, lines: 87 },
        'src/api/routes/**': { statements: 82, branches: 71, functions: 87, lines: 83 },
        'src/config/**': { statements: 92, branches: 74, functions: 97, lines: 92 },
        'src/storage/**': { statements: 76, branches: 50, functions: 78, lines: 79 },

        /**
         * The money path, held at what phase 9 measured and signed off on.
         * A regression in any of these is a regression in what a shop is owed
         * or owes, so they get file-level floors rather than sharing a
         * directory average that could hide a drop.
         */
        'src/services/pricing.ts': { statements: 100, branches: 93, functions: 100, lines: 100 },
        'src/services/tender.ts': { statements: 100, branches: 93, functions: 100, lines: 100 },
        'src/services/returnPricing.ts': { statements: 96, branches: 86, functions: 100, lines: 98 },
        'src/services/reports.ts': { statements: 97, branches: 95, functions: 100, lines: 97 },
        'src/services/pins.ts': { statements: 94, branches: 84, functions: 100, lines: 96 },
      },
    },
  },
});

