import type { FolderId } from '@/core/domain/folder';
import type { SavedTweetView } from '@/core/domain/membership';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import { DomainError } from '@/core/errors/DomainError';
import type {
  ListFolderTweetsPayload,
  ListFolderTweetsResult,
  MembershipCounts,
  RemoveTweetResult,
  SaveTweetResult,
} from '@/messaging/protocol';
import type { XFoldersDatabase } from '../db/XFoldersDatabase';
import { FolderRepository } from '../repositories/FolderRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { MetaRepository } from '../repositories/MetaRepository';
import { TweetRepository } from '../repositories/TweetRepository';
import { broadcast } from './ChangeBroadcaster';

export class TweetSaveService {
  private readonly folders: FolderRepository;
  private readonly memberships: MembershipRepository;
  private readonly tweets: TweetRepository;
  private readonly meta: MetaRepository;

  constructor(private readonly db: XFoldersDatabase) {
    this.folders = new FolderRepository(db);
    this.memberships = new MembershipRepository(db);
    this.tweets = new TweetRepository(db);
    this.meta = new MetaRepository(db);
  }

  /**
   * Idempotent by construction: the membership's compound primary key is
   * `[folderId+tweetId]`, and an existing row keeps its original `savedAt`.
   * That immutability is not just an idempotency nicety — pagination cursors
   * are built from `savedAt`, so rewriting it would reorder pages under a
   * reader mid-scroll.
   */
  async save(folderId: FolderId, incoming: TweetRecord): Promise<SaveTweetResult> {
    const now = Date.now();
    const result = await this.db.transaction(
      'rw',
      this.db.folders,
      this.db.tweets,
      this.db.folderTweets,
      this.db.meta,
      async (): Promise<SaveTweetResult> => {
        await this.folders.require(folderId);
        await this.tweets.upsert(incoming);

        const existing = await this.memberships.get(folderId, incoming.tweetId);
        let savedAt: number;
        let alreadyExists: boolean;
        if (existing === undefined) {
          savedAt = now;
          alreadyExists = false;
          await this.memberships.add({ folderId, tweetId: incoming.tweetId, savedAt });
        } else {
          savedAt = existing.savedAt;
          alreadyExists = true;
        }

        await this.meta.touchRecent(folderId);
        const membershipCount = await this.memberships.countForTweet(incoming.tweetId);
        return { alreadyExists, savedAt, membershipCount };
      },
    );

    await broadcast({
      foldersChanged: true,
      affectedFolderIds: [folderId],
      affectedTweetIds: [incoming.tweetId],
    });
    return result;
  }

  async remove(folderId: FolderId, tweetId: TweetId): Promise<RemoveTweetResult> {
    const result = await this.db.transaction(
      'rw',
      this.db.tweets,
      this.db.folderTweets,
      async (): Promise<RemoveTweetResult> => {
        const existing = await this.memberships.get(folderId, tweetId);
        if (existing === undefined) {
          throw new DomainError('MEMBERSHIP_NOT_FOUND', '这条帖子不在该文件夹中。');
        }
        await this.memberships.remove(folderId, tweetId);
        const membershipCount = await this.memberships.countForTweet(tweetId);
        // Last membership gone: the tweet metadata has no owner left.
        const tweetDeleted = membershipCount === 0;
        if (tweetDeleted) await this.tweets.deleteMany([tweetId]);
        return { membershipCount, tweetDeleted };
      },
    );

    await broadcast({
      foldersChanged: true,
      affectedFolderIds: [folderId],
      affectedTweetIds: [tweetId],
    });
    return result;
  }

  async folderIdsForTweet(tweetId: TweetId): Promise<FolderId[]> {
    return this.db.transaction('r', this.db.folderTweets, async () =>
      this.memberships.folderIdsForTweet(tweetId),
    );
  }

  async countsForTweets(tweetIds: readonly TweetId[]): Promise<MembershipCounts> {
    return this.db.transaction('r', this.db.folderTweets, async () =>
      this.memberships.countsForTweets(tweetIds),
    );
  }

  /**
   * Reads the page and its tweets in one read transaction, so a concurrent
   * orphan GC cannot delete a tweet between the membership scan and the join.
   */
  async listFolderTweets(payload: ListFolderTweetsPayload): Promise<ListFolderTweetsResult> {
    return this.db.transaction(
      'r',
      this.db.folders,
      this.db.folderTweets,
      this.db.tweets,
      async (): Promise<ListFolderTweetsResult> => {
        await this.folders.require(payload.folderId);
        const page = await this.memberships.page(payload.folderId, payload.limit, payload.cursor);
        const records = await this.tweets.getMany(page.memberships.map((m) => m.tweetId));

        const items: SavedTweetView[] = [];
        page.memberships.forEach((membership, index) => {
          const tweet = records[index];
          // A membership without its tweet row is skipped rather than rendered;
          // nextCursor still advances past it so paging cannot stall.
          if (tweet !== undefined) items.push({ tweet, savedAt: membership.savedAt });
        });

        return { items, nextCursor: page.nextCursor };
      },
    );
  }

  async recentFolderIds(): Promise<FolderId[]> {
    return this.db.transaction('r', this.db.meta, async () => this.meta.recentFolderIds());
  }
}
