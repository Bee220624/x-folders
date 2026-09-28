import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import type { VisibleTweetStore } from '@/state/VisibleTweetStore';
import type { CleanupRegistry } from '@/utils/cleanup';
import { extractTweet } from './TweetExtractor';
import { X_SELECTORS, XF_ATTR } from './selectors';
import type { TweetActionInjector } from './TweetActionInjector';

/** Milliseconds of work allowed per idle slice before yielding back. */
const SLICE_BUDGET_MS = 8;

type IdleHandle = number;

function scheduleIdle(callback: () => void): IdleHandle {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') return ric(callback, { timeout: 500 });
  return setTimeout(callback, 16) as unknown as number;
}

function cancelIdle(handle: IdleHandle): void {
  const cic = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
  if (typeof cic === 'function') cic(handle);
  else clearTimeout(handle);
}

/**
 * Turns "these tweet roots changed" into buttons, spreading the work across idle
 * slices with a time budget.
 *
 * A burst of 200 new tweets arriving in one mutation batch must not be enhanced
 * synchronously — that is exactly the work that makes X's timeline stutter mid
 * scroll. The queue drains a few nodes at a time and yields.
 */
export class TweetEnhancer {
  readonly #queue = new Set<HTMLElement>();
  readonly #records = new Map<TweetId, TweetRecord>();
  #handle: IdleHandle | null = null;

  constructor(
    private readonly injector: TweetActionInjector,
    private readonly counts: VisibleTweetStore,
    registry: CleanupRegistry,
  ) {
    registry.add(() => {
      if (this.#handle !== null) cancelIdle(this.#handle);
      this.#handle = null;
      this.#queue.clear();
      this.#records.clear();
    });
  }

  /** The most recent record extracted for a tweet, for the save popover. */
  recordFor(tweetId: TweetId): TweetRecord | null {
    return this.#records.get(tweetId) ?? null;
  }

  enqueue(roots: Iterable<HTMLElement>): void {
    let added = false;
    for (const root of roots) {
      // A node already classified as permanently unextractable is never retried.
      if (root.hasAttribute(XF_ATTR.skip)) continue;
      this.#queue.add(root);
      added = true;
    }
    if (added) this.#schedule();
  }

  #schedule(): void {
    if (this.#handle !== null) return;
    this.#handle = scheduleIdle(() => {
      this.#handle = null;
      this.drain();
      if (this.#queue.size > 0) this.#schedule();
    });
  }

  /** Processes until the time budget is spent. Exposed for tests. */
  drain(budgetMs: number = SLICE_BUDGET_MS): void {
    const started = Date.now();
    const seen: TweetId[] = [];

    for (const root of this.#queue) {
      this.#queue.delete(root);
      if (!root.isConnected) continue;

      const outcome = extractTweet(root, { pathname: location.pathname, now: Date.now() });
      if (outcome.status === 'skip') {
        // Stamped so neither the detector nor the watchdog looks at it again.
        root.setAttribute(XF_ATTR.skip, outcome.reason);
        continue;
      }
      if (outcome.status === 'retry') continue;

      const { record } = outcome;
      this.#records.set(record.tweetId, record);
      seen.push(record.tweetId);
      this.injector.ensure(root, {
        tweetId: record.tweetId,
        savedCount: this.counts.countFor(record.tweetId),
      });

      if (Date.now() - started > budgetMs) break;
    }

    if (seen.length > 0) this.counts.track(seen);
  }

  /**
   * Drops state for tweets that are no longer mounted.
   *
   * X virtualises the timeline precisely so a long scroll does not retain
   * thousands of rows. Without this, the count map and the record map — which
   * holds each tweet's full text, author and URL — would re-introduce exactly
   * that retention in the isolated world, one entry per tweet ever scrolled
   * past. Bounded by what is currently in the DOM, so it is cheap enough for
   * the 2s watchdog tick.
   */
  prune(scope: ParentNode = document): void {
    const live = new Set<TweetId>();
    for (const host of hostsIn(scope)) {
      const tweetId = host.getAttribute(XF_ATTR.tweetId);
      if (tweetId !== null && host.isConnected) live.add(tweetId);
    }
    this.counts.retain(live);
    for (const tweetId of this.#records.keys()) {
      if (!live.has(tweetId)) this.#records.delete(tweetId);
    }
  }

  /**
   * Repaints buttons after a membership count changes. Paint only: running the
   * full `ensure()` here re-located every action bar on the page for each
   * count reply, which is exactly the burst of work a long scroll cannot
   * afford.
   */
  refreshButtons(scope: ParentNode = document): void {
    for (const host of hostsIn(scope)) {
      const tweetId = host.getAttribute(XF_ATTR.tweetId);
      if (tweetId === null) continue;
      this.injector.repaint(host, this.counts.countFor(tweetId));
    }
  }

  get pending(): number {
    return this.#queue.size;
  }
}

function hostsIn(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(`[${XF_ATTR.actionHost}]`));
}

export function markedSkipped(scope: ParentNode = document): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(`[${XF_ATTR.skip}]`));
}

/** Tweet roots that are mounted but have no button yet. */
export function tweetsMissingButton(scope: ParentNode = document): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot)).filter(
    (root) =>
      root.isConnected &&
      !root.hasAttribute(XF_ATTR.skip) &&
      root.querySelector(`[${XF_ATTR.actionHost}]`) === null,
  );
}
