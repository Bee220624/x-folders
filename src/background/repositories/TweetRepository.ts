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
   * Merge, not blind overwrite. A re-save of an already stored tweet keeps the
   * original `capturedAt`, and never replaces a known author/text with an empty
   * one just because the DOM was half-rendered on this pass.
   */
  async upsert(incoming: TweetRecord): Promise<TweetRecord> {
    const existing = await this.get(incoming.tweetId);
    const merged: TweetRecord =
      existing === undefined
        ? incoming
        : {
            ...existing,
            canonicalUrl: incoming.canonicalUrl,
            username: incoming.username,
            authorName: incoming.authorName ?? existing.authorName,
            text: incoming.text.length > 0 ? incoming.text : existing.text,
            capturedAt: existing.capturedAt,
            updatedAt: incoming.updatedAt,
          };
    await this.db.tweets.put(merged);
    return merged;
  }

  async deleteMany(tweetIds: readonly TweetId[]): Promise<number> {
    if (tweetIds.length === 0) return 0;
    await this.db.tweets.bulkDelete([...tweetIds]);
    return tweetIds.length;
  }
}
