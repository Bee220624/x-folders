import { DEBUG_FLAG_KEY } from '@/core/constants';

/**
 * Switchable logger. Nothing in the production path calls `console.*` directly.
 *
 * Debug output is off until something calls `setLogLevel('debug')`. Each
 * entrypoint does that on startup if the extension's own storage says so; see
 * `applyStoredLogLevel`.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER.warn;

export function setLogLevel(level: Level): void {
  threshold = ORDER[level];
}

/**
 * Raises the level to debug if the extension's storage carries the flag.
 *
 * Read from `chrome.storage.local`, never `localStorage`. In a content script
 * `localStorage` is the *page origin's* store, which would let x.com — or any
 * script it loads — switch our logging on for every later session. This key is
 * in the extension's own storage, which the page cannot write.
 *
 * Called once per context at startup, so toggling the flag takes effect on the
 * next page load or worker wake.
 */
export async function applyStoredLogLevel(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(DEBUG_FLAG_KEY);
    if (stored[DEBUG_FLAG_KEY] === true) setLogLevel('debug');
  } catch {
    // Storage is unavailable while an extension context is being torn down, and
    // logging is never worth throwing over. The default `warn` stands.
  }
}

function emit(level: Level, scope: string, args: readonly unknown[]): void {
  if (ORDER[level] < threshold) return;
  const prefix = `[xf:${scope}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
  };
}
