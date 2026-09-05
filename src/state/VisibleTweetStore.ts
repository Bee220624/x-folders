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
  /**
   * Monotonic tick used to order local writes against in-flight reads.
   *
   * A count read starts when a tweet scrolls into view; the user can save that
   * tweet from the popover while the read is still in flight. The reply was
   * computed BEFORE the save, so applying it blindly would flip the button back
   * to "not saved" a moment after a save that actually succeeded.
   */
  #epoch = 0;
  readonly #localEpoch = new Map<TweetId, number>();

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
      this.#localEpoch.clear();
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
    this.#localEpoch.set(tweetId, ++this.#epoch);
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
    const startedAt = ++this.#epoch;

    for (let i = 0; i < ids.length; i += MEMBERSHIP_COUNT_BATCH_MAX) {
      const chunk = ids.slice(i, i + MEMBERSHIP_COUNT_BATCH_MAX);
      const result = await rpc('memberships.getCountsForTweets', { tweetIds: chunk });
      if (!result.ok) continue;
      // Every requested id is present in the response, so an unsaved tweet is
      // written back as 0 rather than keeping a stale filled icon — unless a
      // save landed locally after this read began, in which case the local
      // value is the newer truth and the reply is stale for that id alone.
      for (const [tweetId, count] of Object.entries(result.data)) {
        const localAt = this.#localEpoch.get(tweetId);
        if (localAt !== undefined && localAt > startedAt) continue;
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
    for (const tweetId of this.#localEpoch.keys()) {
      if (!visible.has(tweetId)) this.#localEpoch.delete(tweetId);
    }
  }
}
