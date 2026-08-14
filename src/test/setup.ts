import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// In-memory localStorage.
//
// This has to actually store values: code under test writes a key and then reads it
// back (auth token handling, for one). Bare vi.fn() stubs return undefined from
// getItem no matter what was set, which silently turns "token is present" tests into
// "token is absent" tests that can never pass.
const createLocalStorageMock = (): Storage => {
  let store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store = new Map<string, string>();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
};

global.localStorage = createLocalStorageMock();

// jsdom implements no ResizeObserver, and recharts' ResponsiveContainer
// constructs one on mount. Without this any page carrying a chart throws during
// render, which is a gap in the test environment rather than anything about the
// page.
const globalWithObserver = globalThis as { ResizeObserver?: typeof ResizeObserver };

if (!globalWithObserver.ResizeObserver) {
  globalWithObserver.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

