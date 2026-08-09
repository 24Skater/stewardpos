import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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

