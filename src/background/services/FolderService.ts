import type { Folder, FolderId, FolderWithCount } from '@/core/domain/folder';
import { DomainError } from '@/core/errors/DomainError';
import type {
  DeleteFolderPreview,
  DeleteFolderResult,
  FoldersSnapshot,
} from '@/messaging/protocol';
import type { XFoldersDatabase } from '../db/XFoldersDatabase';
import { FolderRepository } from '../repositories/FolderRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { MetaRepository } from '../repositories/MetaRepository';
import { TweetRepository } from '../repositories/TweetRepository';
import { broadcast, type ChangeSet } from './ChangeBroadcaster';

/** Bounds the working set of a cascade so one delete cannot balloon memory. */
const GC_CHUNK = 500;

/**
 * Every mutation follows the same shape: one Dexie transaction that returns a
 * plain change descriptor, then the broadcast *after* the transaction resolves.
 * Awaiting a non-Dexie promise (chrome.*, fetch, setTimeout) inside a
 * transaction drops out of Dexie's zone and IndexedDB auto-commits, which either
 * throws PrematureCommitError or silently runs the remaining steps unprotected.
 */
export class FolderService {
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

  async snapshot(): Promise<FoldersSnapshot> {
    return this.db.transaction('r', this.db.folders, this.db.folderTweets, this.db.meta, async () => {
      const folders = await this.folders.listAll();
      const withCounts: FolderWithCount[] = [];
      for (const folder of folders) {
        withCounts.push({
          ...folder,
          tweetCount: await this.memberships.countInFolder(folder.id),
        });
      }
      return {
        folders: withCounts,
        recentFolderIds: await this.meta.recentFolderIds(),
      };
    });
  }

  async create(name: string, parentId: FolderId | null): Promise<Folder> {
    const now = Date.now();
    const folder = await this.db.transaction('rw', this.db.folders, async () =>
      this.folders.create(name, parentId, now),
    );
    await broadcast({ foldersChanged: true, affectedFolderIds: [folder.id] });
    return folder;
  }

  async rename(folderId: FolderId, name: string): Promise<Folder> {
    const now = Date.now();
    const folder = await this.db.transaction('rw', this.db.folders, async () =>
      this.folders.rename(folderId, name, now),
    );
    await broadcast({ foldersChanged: true, affectedFolderIds: [folder.id] });
    return folder;
  }

  async setCollapsed(folderId: FolderId, collapsed: boolean): Promise<Folder> {
    const now = Date.now();
    const folder = await this.db.transaction('rw', this.db.folders, async () =>
      this.folders.setCollapsed(folderId, collapsed, now),
    );
    // Collapse state is local UI chrome; it still broadcasts so a second tab
    // does not drift, but it never invalidates tweet state.
    await broadcast({ foldersChanged: true, affectedFolderIds: [folder.id] });
    return folder;
  }

  async move(folderId: FolderId, direction: -1 | 1): Promise<FoldersSnapshot> {
    const now = Date.now();
    const moved = await this.db.transaction('rw', this.db.folders, async () =>
      this.folders.move(folderId, direction, now),
    );
    if (moved.length > 0) {
      await broadcast({ foldersChanged: true, affectedFolderIds: moved.map((f) => f.id) });
    }
    return this.snapshot();
  }

  /** Powers the delete confirmation copy; read-only. */
  async deletePreview(folderId: FolderId): Promise<DeleteFolderPreview> {
    return this.db.transaction('r', this.db.folders, this.db.folderTweets, async () => {
      const folder = await this.folders.require(folderId);
      const subtree = await this.folders.subtreeIds(folderId);
      let membershipCount = 0;
      for (const id of subtree) {
        membershipCount += await this.memberships.countInFolder(id);
      }
      return {
        folderId,
        name: folder.name,
        descendantCount: subtree.length - 1,
        membershipCount,
      };
    });
  }

  async delete(folderId: FolderId): Promise<DeleteFolderResult> {
    const result = await this.db.transaction(
      'rw',
      this.db.folders,
      this.db.folderTweets,
      this.db.tweets,
      this.db.meta,
      async (): Promise<DeleteFolderResult & { change: ChangeSet }> => {
        await this.folders.require(folderId);
        const subtree = await this.folders.subtreeIds(folderId);

        // Capture the affected tweets *before* the memberships disappear.
        const affected = [...new Set(await this.memberships.tweetIdsInFolders(subtree))];
        const deletedMemberships = await this.memberships.deleteByFolders(subtree);
        await this.folders.deleteMany(subtree);

        // Orphan GC: one indexed lookup per chunk instead of one count per tweet.
        const orphans: string[] = [];
        for (let i = 0; i < affected.length; i += GC_CHUNK) {
          const chunk = affected.slice(i, i + GC_CHUNK);
          const counts = await this.memberships.countsForTweets(chunk);
          for (const tweetId of chunk) {
            if ((counts[tweetId] ?? 0) === 0) orphans.push(tweetId);
          }
        }
        await this.tweets.deleteMany(orphans);
        await this.meta.removeRecent(subtree);

        return {
          deletedFolderIds: subtree,
          deletedMemberships,
          deletedTweets: orphans.length,
          change: {
            foldersChanged: true,
            affectedFolderIds: subtree,
            affectedTweetIds: affected,
          },
        };
      },
    );

    const { change, ...payload } = result;
    await broadcast(change);
    return payload;
  }

  /** Guard used by callers that must not act on a vanished folder. */
  async requireExists(folderId: FolderId): Promise<void> {
    const folder = await this.folders.get(folderId);
    if (folder === undefined) {
      throw new DomainError('FOLDER_NOT_FOUND', '文件夹不存在。', { folderId });
    }
  }
}
