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
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

