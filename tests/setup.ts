import 'fake-indexeddb/auto';
import { vi } from 'vitest';

/**
 * Minimal `chrome` stub. The extension only touches `storage.local`,
 * `storage.onChanged`, `runtime.sendMessage` and `runtime.getManifest`; anything
 * else is intentionally absent so an accidental new API dependency fails loudly
 * in tests.
 */
interface StoredListener {
  (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string): void;
}

const store = new Map<string, unknown>();
const changeListeners = new Set<StoredListener>();

const chromeStub = {
  runtime: {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn(),
    getManifest: vi.fn(() => ({ manifest_version: 3, name: 'X Folders (test)', version: '0.0.0-test' })),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    local: {
      async get(keys?: string | string[]): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {};
        const wanted = keys === undefined ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
        for (const key of wanted) {
          if (store.has(key)) out[key] = store.get(key);
        }
        return out;
      },
      async set(items: Record<string, unknown>): Promise<void> {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: store.get(key), newValue: value };
          store.set(key, value);
        }
        for (const listener of changeListeners) listener(changes, 'local');
      },
      async remove(key: string): Promise<void> {
        store.delete(key);
      },
    },
    onChanged: {
      addListener(listener: StoredListener): void {
        changeListeners.add(listener);
      },
      removeListener(listener: StoredListener): void {
        changeListeners.delete(listener);
      },
    },
  },
};

/**
 * jsdom implements neither of these. ThemeAdapter uses matchMedia for its
 * prefers-color-scheme fallback, and the sidebar/folder view observe element
 * size, so without shims those code paths throw rather than being exercised.
 */
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis.ResizeObserver !== 'function') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  });
}

Object.defineProperty(globalThis, 'chrome', { value: chromeStub, writable: true });

export function resetChromeStub(): void {
  store.clear();
  changeListeners.clear();
  chromeStub.runtime.lastError = undefined;
}

export function chromeStorageSnapshot(): Map<string, unknown> {
  return new Map(store);
}
