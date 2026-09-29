import Dexie, { type EntityTable, type Table } from 'dexie';
import { DB_NAME } from '@/core/constants';
import type { FolderId } from '@/core/domain/folder';
import type { TweetId } from '@/core/domain/tweet';
import { SCHEMA_V1, SCHEMA_V2, type FolderRow, type MembershipRow, type MetaRow, type TweetRow } from './schema';
import { upgradeToV2 } from './migrations';

export class XFoldersDatabase extends Dexie {
  declare folders: EntityTable<FolderRow, 'id'>;
  declare tweets: EntityTable<TweetRow, 'tweetId'>;
  // Compound primary key, so this is `Table<T, TKey>` rather than `EntityTable`:
  // EntityTable derives its key from a named property and resolves to `never` here.
  declare folderTweets: Table<MembershipRow, [FolderId, TweetId]>;
  declare meta: EntityTable<MetaRow, 'key'>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores(SCHEMA_V2).upgrade(upgradeToV2);
  }
}

let instance: XFoldersDatabase | null = null;

/**
 * Opened lazily and cached on the worker global. A terminated worker simply
 * loses the handle; the next wake-up reopens it. IndexedDB stays the only
 * source of truth, so nothing is lost with the handle.
 */
export function getDatabase(): XFoldersDatabase {
  instance ??= new XFoldersDatabase();
  return instance;
}

/** Test seam: swap in a database backed by fake-indexeddb. */
export function setDatabaseForTesting(db: XFoldersDatabase | null): void {
  instance = db;
}
