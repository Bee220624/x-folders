import type { FolderId } from '@/core/domain/folder';
import type { FolderTweetMembership, FolderTweetsCursor } from '@/core/domain/membership';
import type { TweetId } from '@/core/domain/tweet';
import { MEMBERSHIP_PAGE_INDEX } from '../db/schema';
import type { XFoldersDatabase } from '../db/XFoldersDatabase';

export interface MembershipPage {
  memberships: FolderTweetMembership[];
  nextCursor: FolderTweetsCursor | null;
}

export class MembershipRepository {
  constructor(private readonly db: XFoldersDatabase) {}

  async get(folderId: FolderId, tweetId: TweetId): Promise<FolderTweetMembership | undefined> {
    return this.db.folderTweets.get([folderId, tweetId]);
  }

  async add(membership: FolderTweetMembership): Promise<void> {
    await this.db.folderTweets.add(membership);
  }

  async remove(folderId: FolderId, tweetId: TweetId): Promise<void> {
    await this.db.folderTweets.delete([folderId, tweetId]);
  }

  async countInFolder(folderId: FolderId): Promise<number> {
    return this.db.folderTweets.where('folderId').equals(folderId).count();
  }

  async countForTweet(tweetId: TweetId): Promise<number> {
    return this.db.folderTweets.where('tweetId').equals(tweetId).count();
  }

  async folderIdsForTweet(tweetId: TweetId): Promise<FolderId[]> {
    const rows = await this.db.folderTweets.where('tweetId').equals(tweetId).toArray();
    return rows.map((row) => row.folderId);
  }

  /**
   * One indexed range scan for the whole batch instead of N counts. Every
   * requested id gets an entry — a sparse result would leave the caller unable
   * to tell "not saved" from "not asked", and stale icons would survive.
   */
  async countsForTweets(tweetIds: readonly TweetId[]): Promise<Record<TweetId, number>> {
    const counts: Record<TweetId, number> = {};
    for (const tweetId of tweetIds) counts[tweetId] = 0;
    if (tweetIds.length === 0) return counts;
    const rows = await this.db.folderTweets.where('tweetId').anyOf([...tweetIds]).toArray();
    for (const row of rows) {
      counts[row.tweetId] = (counts[row.tweetId] ?? 0) + 1;
    }
    return counts;
  }

  async tweetIdsInFolders(folderIds: readonly FolderId[]): Promise<TweetId[]> {
    if (folderIds.length === 0) return [];
    const rows = await this.db.folderTweets.where('folderId').anyOf([...folderIds]).toArray();
    return rows.map((row) => row.tweetId);
  }

  async deleteByFolders(folderIds: readonly FolderId[]): Promise<number> {
    if (folderIds.length === 0) return 0;
    return this.db.folderTweets.where('folderId').anyOf([...folderIds]).delete();
  }

  /**
   * Keyset pagination over `[folderId+savedAt+tweetId]`, newest first.
   *
   * The traversal order is the index's own order reversed: `savedAt` descending,
   * then `tweetId` descending *by code unit* — IndexedDB compares the id as a
   * string. That is intentional and must not be "fixed" by re-sorting
   * numerically in JS: a JS order that disagrees with the index order makes the
   * cursor point into the middle of a tie group and silently skips rows.
   *
   * The upper bound is exclusive whenever a cursor is supplied, which is what
   * makes ties on `savedAt` gapless and duplicate-free. `limit + 1` rows are
   * fetched so `nextCursor` is derived without a second query.
   */
  async page(
    folderId: FolderId,
    limit: number,
    cursor: FolderTweetsCursor | undefined,
  ): Promise<MembershipPage> {
    // Bounds are built from IndexedDB's own type ordering rather than
    // Dexie.minKey/maxKey: those are -Infinity and [[]], which some IndexedDB
    // implementations (including fake-indexeddb, used by the tests) reject as
    // keys outright. Within a fixed folderId, array keys compare element-wise
    // and a shorter array sorts before a longer one with the same prefix, so
    // `[folderId]` is below every `[folderId, savedAt, tweetId]`. Arrays also
    // sort after every string and number, so `[folderId, []]` is above them all.
    const lower = [folderId];
    const upper =
      cursor === undefined ? [folderId, []] : [folderId, cursor.savedAt, cursor.tweetId];

    const rows = await this.db.folderTweets
      .where(MEMBERSHIP_PAGE_INDEX)
      .between(lower, upper, true, cursor === undefined)
      .reverse()
      .limit(limit + 1)
      .toArray();

    const hasMore = rows.length > limit;
    const memberships = hasMore ? rows.slice(0, limit) : rows;
    const last = memberships[memberships.length - 1];
    return {
      memberships,
      // The cursor comes from the raw membership, not from what the UI managed
      // to render: dropping a row whose tweet is missing must not shorten paging.
      nextCursor:
        hasMore && last !== undefined ? { savedAt: last.savedAt, tweetId: last.tweetId } : null,
    };
  }
}
