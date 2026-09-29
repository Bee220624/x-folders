import { SNAPSHOT_REFRESH_BATCH_MAX } from '@/core/constants';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import { rpc } from '@/messaging/RpcClient';
import type { CleanupRegistry } from '@/utils/cleanup';

/** Window in which sightings are merged into one message. */
const BATCH_WINDOW_MS = 250;
/** Remembered signatures before starting over; bounds memory in a long session. */
const SEEN_MAX = 5_000;

export type RefreshSender = (records: TweetRecord[]) => Promise<void>;

async function sendToBackground(records: TweetRecord[]): Promise<void> {
  await rpc('tweets.refresh', { tweets: records });
}

/**
 * What a capture shows that can only grow as the page finishes rendering. A
 * post is sent again only when this changes: scrolling past a saved post a
 * second time costs nothing, while seeing its full text on its own page after
 * a truncated sighting — or its pictures finally loaded — still gets through.
 */
function signature(record: TweetRecord): string {
  return [
    record.tweetId,
    record.truncated ? 'cut' : 'full',
    record.text.length,
    record.media.length,
    record.avatarUrl === null ? 0 : 1,
    record.quote === null ? 0 : 1,
    record.card === null ? 0 : 1,
  ].join(':');
}

/**
 * Sends fresh captures of already-saved posts back to the database. Only posts
 * the page knows are saved are offered; the background ignores anything it
 * does not have, so a stale count costs one wasted message at most.
 */
export class SnapshotRefresher {
  readonly #pending = new Map<TweetId, TweetRecord>();
  readonly #seen = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: RefreshSender = sendToBackground) {}

  attach(registry: CleanupRegistry): void {
    registry.add(() => {
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#timer = null;
      this.#pending.clear();
      this.#seen.clear();
    });
  }

  offer(record: TweetRecord): void {
    const key = signature(record);
    if (this.#seen.has(key)) return;
    if (this.#seen.size >= SEEN_MAX) this.#seen.clear();
    this.#seen.add(key);
    this.#pending.set(record.tweetId, record);
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#flush();
    }, BATCH_WINDOW_MS);
  }

  async #flush(): Promise<void> {
    const records = [...this.#pending.values()];
    this.#pending.clear();
    for (let index = 0; index < records.length; index += SNAPSHOT_REFRESH_BATCH_MAX) {
      await this.send(records.slice(index, index + SNAPSHOT_REFRESH_BATCH_MAX));
    }
  }
}
