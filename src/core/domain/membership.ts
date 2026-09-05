import type { FolderId } from './folder';
import type { TweetId, TweetRecord } from './tweet';

export interface FolderTweetMembership {
  folderId: FolderId;
  tweetId: TweetId;
  /** Set once, on first save; never rewritten. Pagination cursors depend on it. */
  savedAt: number;
}

/** A membership joined with its tweet, as rendered in the folder view. */
export interface SavedTweetView {
  tweet: TweetRecord;
  savedAt: number;
}

/**
 * Keyset cursor for `savedAt`-descending pagination. Both fields are required:
 * `savedAt` alone loses rows whenever two saves share a millisecond.
 */
export interface FolderTweetsCursor {
  savedAt: number;
  tweetId: TweetId;
}

export interface RecentFoldersMeta {
  key: 'recentFolders';
  folderIds: FolderId[];
}
