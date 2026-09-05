import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';

const log = createLogger('route');

/** Backstop poll for navigations that emit no event we can hear. */
const POLL_MS = 500;

/**
 * Delays at which a post-navigation `ensure()` runs. X renders the new route in
 * stages, so a single immediate pass reliably misses the timeline.
 */
export const ENSURE_DELAYS_MS = [0, 250, 1000] as const;

export interface RouteObserverOptions {
  registry: CleanupRegistry;
  /** Runs once per settle step after every route change. */
  onEnsure: () => void;
  /** Runs once per route change, before the ensure passes. */
  onRouteChange: (next: string, previous: string) => void;
}

/**
 * Watches X's client-side navigation without entering the page's main world.
 *
 * MV3 content scripts run in an isolated world, so patching `history.pushState`
 * would require injecting a script into the page — more privilege and more
 * breakage than this problem is worth. `popstate` + `hashchange` + a cheap
 * href poll covers every real navigation, and `check()` is also called at the
 * end of each mutation batch so the poll is rarely the thing that notices.
 */
export class RouteObserver {
  #current: string;
  /** Pending ensure passes -> their registry handles, so both can be undone. */
  readonly #pending = new Map<ReturnType<typeof setTimeout>, () => void>();
  readonly #options: RouteObserverOptions;

  constructor(options: RouteObserverOptions) {
    this.#options = options;
    this.#current = location.href;
  }

  start(): void {
    const { registry } = this.#options;
    const onEvent = (): void => this.check();
    registry.addEventListener(window, 'popstate', onEvent);
    registry.addEventListener(window, 'hashchange', onEvent);

    const poll = setInterval(onEvent, POLL_MS);
    registry.addInterval(poll);
    registry.add(() => this.#cancelPending());
  }

  get currentHref(): string {
    return this.#current;
  }

  /** Cheap enough to call at the end of every mutation batch. */
  check(): void {
    const next = location.href;
    if (next === this.#current) return;
    const previous = this.#current;
    this.#current = next;
    log.debug('route change', previous, '->', next);

    // Pending passes belong to the route we just left.
    this.#cancelPending();
    this.#options.onRouteChange(next, previous);

    for (const delay of ENSURE_DELAYS_MS) {
      const timer = setTimeout(() => {
        // Take the entry off the registry as well as out of #pending: deleting
        // only from the map leaves the disposer behind, which is the leak this
        // whole structure exists to prevent.
        const unregister = this.#pending.get(timer);
        this.#pending.delete(timer);
        unregister?.();
        this.#options.onEnsure();
      }, delay);
      // Keep the registry handle. Discarding it leaks three dead closures per
      // navigation, and X is a site people navigate all day.
      this.#pending.set(timer, this.#options.registry.addTimeout(timer));
    }
  }

  #cancelPending(): void {
    for (const unregister of this.#pending.values()) unregister();
    this.#pending.clear();
  }
}
