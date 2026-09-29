import { mergeSnapshot, sameSnapshot } from '@/core/domain/snapshot';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import type { XFoldersDatabase } from '../db/XFoldersDatabase';

export class TweetRepository {
  constructor(private readonly db: XFoldersDatabase) {}

  async get(tweetId: TweetId): Promise<TweetRecord | undefined> {
    return this.db.tweets.get(tweetId);
  }

  async getMany(tweetIds: readonly TweetId[]): Promise<(TweetRecord | undefined)[]> {
    if (tweetIds.length === 0) return [];
    return this.db.tweets.bulkGet([...tweetIds]);
  }

  /**
   * Stores a capture folded into whatever is already there (see
   * mergeSnapshot): a re-save can complete a snapshot but never degrade it,
   * and the first capture time is kept.
   */
  async upsert(incoming: TweetRecord): Promise<TweetRecord> {
    const existing = await this.get(incoming.tweetId);
    const merged = existing === undefined ? incoming : mergeSnapshot(existing, incoming);
    await this.db.tweets.put(merged);
    return merged;
  }

  /**
   * Folds a later sighting into a post that is already stored. Returns the new
   * record when something visible changed; null when the post is not stored —
   * a sighting never creates a row — or when nothing changed, so nothing is
   * written.
   */
  async refresh(incoming: TweetRecord): Promise<TweetRecord | null> {
    const existing = await this.get(incoming.tweetId);
    if (existing === undefined) return null;
    const merged = mergeSnapshot(existing, incoming);
    if (sameSnapshot(existing, merged)) return null;
    await this.db.tweets.put(merged);
    return merged;
  }

  async deleteMany(tweetIds: readonly TweetId[]): Promise<number> {
    if (tweetIds.length === 0) return 0;
    await this.db.tweets.bulkDelete([...tweetIds]);
    return tweetIds.length;
  }
}
