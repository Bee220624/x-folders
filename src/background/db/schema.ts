import type { Folder } from '@/core/domain/folder';
import type { FolderTweetMembership, RecentFoldersMeta } from '@/core/domain/membership';
import type { TweetRecord } from '@/core/domain/tweet';

/** Row shapes as stored. They are the domain types verbatim — no shadow fields. */
export type FolderRow = Folder;
export type TweetRow = TweetRecord;
export type MembershipRow = FolderTweetMembership;
export type MetaRow = RecentFoldersMeta;

/** The single index used for `savedAt`-descending pagination. */
export const MEMBERSHIP_PAGE_INDEX = '[folderId+savedAt+tweetId]';

/**
 * Version 1 stores.
 *
 * `folders.parentId` is deliberately NOT indexed. IndexedDB rejects `null` as a
 * key, so a `parentId` index would silently omit every root folder and any
 * query built on it would return an incomplete tree. Folder counts are small
 * (tens), so the tree is grouped in memory instead.
 *
 * `folderTweets` uses a compound primary key, which is what makes a repeated
 * save idempotent at the storage layer rather than by convention.
 */
export const SCHEMA_V1 = {
  folders: 'id, position, createdAt, updatedAt',
  tweets: 'tweetId, username, updatedAt',
  folderTweets: `[folderId+tweetId], folderId, tweetId, ${MEMBERSHIP_PAGE_INDEX}`,
  meta: 'key',
} as const;

/**
 * Version 2 keeps every index of version 1 — the snapshot fields are row
 * content, not keys. The bump exists for the upgrade in migrations.ts.
 */
export const SCHEMA_V2 = SCHEMA_V1;
