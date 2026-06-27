import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetTestNavigation } from './navigation';

configure({ testIdAttribute: 'data-test' });

// jsdom (vitest 4) does not expose localStorage/sessionStorage on the global
// scope, but app code reads them via bare `localStorage`. Provide an in-memory
// fallback so storage helpers return null instead of crashing on undefined.
const createMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
};

if (!globalThis.localStorage) {
  globalThis.localStorage = createMemoryStorage() as Storage;
}
if (!globalThis.sessionStorage) {
  globalThis.sessionStorage = createMemoryStorage() as Storage;
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    readText: vi.fn(),
    writeText: vi.fn(),
  },
});

window.scrollTo = vi.fn();

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds = [];

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

window.ResizeObserver = ResizeObserver;
window.IntersectionObserver = IntersectionObserver;

afterEach(() => {
  cleanup();
  resetTestNavigation();
  vi.restoreAllMocks();
});
