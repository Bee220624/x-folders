import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';

const log = createLogger('health');

const TICK_MS = 2000;

export interface HealthChecks {
  /** Re-mounts the sidebar if its host was detached or duplicated. */
  ensureSidebar: () => void;
  /** Re-aligns or closes the folder view. */
  ensureFolderView: () => void;
  /** Closes the popover if its anchor left the DOM. */
  ensurePopover: () => void;
  /** Re-injects buttons on currently mounted tweets that are missing one. */
  ensureTweetButtons: () => void;
}

/**
 * Periodic self-heal for the things React can silently take away.
 *
 * Deliberately cheap: it runs every 2s, only over what is currently mounted
 * (X virtualises the timeline, so that is a few dozen nodes, not the whole
 * scroll history), and it stops entirely while the tab is hidden — a background
 * tab has nothing to repair and a running interval there is pure battery cost.
 */
export class HealthMonitor {
  #timer: ReturnType<typeof setInterval> | null = null;
  #stopInterval: (() => void) | null = null;
  #running = false;

  constructor(
    private readonly checks: HealthChecks,
    private readonly registry: CleanupRegistry,
  ) {}

  start(): void {
    this.#resume();
    const onVisibility = (): void => {
      if (document.hidden) {
        this.#pause();
      } else {
        // Catch up immediately rather than waiting out a full tick: the page may
        // have been rebuilt while we were not looking.
        this.#resume();
        this.tick();
      }
    };
    this.registry.addEventListener(document, 'visibilitychange', onVisibility);
    this.registry.add(() => this.#pause());
  }

  get running(): boolean {
    return this.#timer !== null;
  }

  #resume(): void {
    if (this.#timer !== null || document.hidden) return;
    this.#timer = setInterval(() => this.tick(), TICK_MS);
    // Hold the handle: a tab that is hidden and shown all day would otherwise
    // add one dead closure to the registry per cycle.
    this.#stopInterval = this.registry.addInterval(this.#timer);
  }

  #pause(): void {
    if (this.#timer === null) return;
    this.#stopInterval?.();
    this.#stopInterval = null;
    this.#timer = null;
  }

  /** Exposed so tests need no timers. */
  tick(): void {
    // Single-flight: a slow check must not overlap with the next tick and turn
    // one repair into a queue of them.
    if (this.#running) return;
    this.#running = true;
    try {
      this.checks.ensureSidebar();
      this.checks.ensureFolderView();
      this.checks.ensurePopover();
      this.checks.ensureTweetButtons();
    } catch (error) {
      log.warn('health tick failed', error);
    } finally {
      this.#running = false;
    }
  }
}
