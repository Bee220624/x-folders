import { MEMBERSHIP_COUNT_BATCH_MAX } from '@/core/constants';
import type { TweetId } from '@/core/domain/tweet';
import { rpc } from '@/messaging/RpcClient';
import type { CleanupRegistry } from '@/utils/cleanup';

/** Window in which newly seen tweets are merged into one RPC. */
const BATCH_WINDOW_MS = 50;

export type CountsListener = (counts: ReadonlyMap<TweetId, number>) => void;

/**
 * Tracks the membership count of every tweet currently on screen.
 *
 * Requests are batched: scrolling can reveal a dozen tweets in one frame, and
 * one message per tweet would wake the service worker a dozen times.
 */
export class VisibleTweetStore {
  readonly #counts = new Map<TweetId, number>();
  readonly #pending = new Set<TweetId>();
  readonly #listeners = new Set<CountsListener>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  get counts(): ReadonlyMap<TweetId, number> {
    return this.#counts;
  }

  countFor(tweetId: TweetId): number {
    return this.#counts.get(tweetId) ?? 0;
  }

  subscribe(listener: CountsListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  attach(registry: CleanupRegistry): void {
    registry.add(() => {
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#timer = null;
      this.#listeners.clear();
      this.#pending.clear();
    });
  }

  /** Queues ids whose count is not known yet. */
  track(tweetIds: Iterable<TweetId>): void {
    let added = false;
    for (const tweetId of tweetIds) {
      if (this.#counts.has(tweetId)) continue;
      this.#pending.add(tweetId);
      added = true;
    }
    if (added) this.#schedule();
  }

  /** Forces a refresh for ids we already know, after a write. */
  invalidate(tweetIds: Iterable<TweetId>): void {
    let added = false;
    for (const tweetId of tweetIds) {
      this.#pending.add(tweetId);
      added = true;
    }
    if (added) this.#schedule();
  }

  setLocal(tweetId: TweetId, count: number): void {
    this.#counts.set(tweetId, count);
    this.#emit();
  }

  #schedule(): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#flush();
    }, BATCH_WINDOW_MS);
  }

  async #flush(): Promise<void> {
    if (this.#pending.size === 0) return;
    const ids = [...this.#pending];
    this.#pending.clear();

    for (let i = 0; i < ids.length; i += MEMBERSHIP_COUNT_BATCH_MAX) {
      const chunk = ids.slice(i, i + MEMBERSHIP_COUNT_BATCH_MAX);
      const result = await rpc('memberships.getCountsForTweets', { tweetIds: chunk });
      if (!result.ok) continue;
      // Every requested id is present in the response, so an unsaved tweet is
      // written back as 0 rather than keeping a stale filled icon.
      for (const [tweetId, count] of Object.entries(result.data)) {
        this.#counts.set(tweetId, count);
      }
    }
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#counts);
  }

  /** Drops ids that are no longer on screen so the map cannot grow unbounded. */
  retain(visible: ReadonlySet<TweetId>): void {
    for (const tweetId of this.#counts.keys()) {
      if (!visible.has(tweetId)) this.#counts.delete(tweetId);
    }
  }
}
