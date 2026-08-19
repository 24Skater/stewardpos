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
    },
  },
});

