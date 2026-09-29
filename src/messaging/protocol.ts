import type { Folder, FolderId, FolderWithCount } from '@/core/domain/folder';
import type {
  FolderTweetsCursor,
  SavedTweetView,
} from '@/core/domain/membership';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';

/* -------------------------------------------------------------------------- */
/* Payloads                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateFolderPayload {
  name: string;
  parentId: FolderId | null;
}

export interface RenameFolderPayload {
  folderId: FolderId;
  name: string;
}

export interface SetCollapsedPayload {
  folderId: FolderId;
  collapsed: boolean;
}

export interface FolderIdPayload {
  folderId: FolderId;
}

export interface TweetIdPayload {
  tweetId: TweetId;
}

export interface TweetIdsPayload {
  tweetIds: TweetId[];
}

export interface SaveTweetPayload {
  folderId: FolderId;
  tweet: TweetRecord;
}

export interface RemoveTweetPayload {
  folderId: FolderId;
  tweetId: TweetId;
}

export interface RefreshTweetsPayload {
  tweets: TweetRecord[];
}

export interface ListFolderTweetsPayload {
  folderId: FolderId;
  /** Clamped server-side to FOLDER_TWEETS_PAGE_SIZE. */
  limit: number;
  cursor?: FolderTweetsCursor;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export interface FoldersSnapshot {
  folders: FolderWithCount[];
  recentFolderIds: FolderId[];
}

export interface SaveTweetResult {
  /** True when the membership already existed; `savedAt` is then unchanged. */
  alreadyExists: boolean;
  savedAt: number;
  membershipCount: number;
}

export interface RemoveTweetResult {
  membershipCount: number;
  /** True when the tweet lost its last membership and its metadata was GC'd. */
  tweetDeleted: boolean;
}

export interface RefreshTweetsResult {
  /** Posts whose stored snapshot actually changed. */
  updated: TweetId[];
}

export interface DeleteFolderResult {
  deletedFolderIds: FolderId[];
  deletedMemberships: number;
  deletedTweets: number;
}

export interface DeleteFolderPreview {
  folderId: FolderId;
  name: string;
  descendantCount: number;
  membershipCount: number;
}

export interface ListFolderTweetsResult {
  items: SavedTweetView[];
  nextCursor: FolderTweetsCursor | null;
}

/** Sparse map is avoided on purpose: every requested id gets an entry. */
export type MembershipCounts = Record<TweetId, number>;

/* -------------------------------------------------------------------------- */
/* Method table                                                                */
/* -------------------------------------------------------------------------- */

export interface RpcMethods {
  'health.ping': { payload: undefined; result: { ok: true; version: string } };

  'folders.list': { payload: undefined; result: FoldersSnapshot };
  'folders.create': { payload: CreateFolderPayload; result: Folder };
  'folders.rename': { payload: RenameFolderPayload; result: Folder };
  'folders.setCollapsed': { payload: SetCollapsedPayload; result: Folder };
  'folders.moveUp': { payload: FolderIdPayload; result: FoldersSnapshot };
  'folders.moveDown': { payload: FolderIdPayload; result: FoldersSnapshot };
  'folders.deletePreview': { payload: FolderIdPayload; result: DeleteFolderPreview };
  'folders.delete': { payload: FolderIdPayload; result: DeleteFolderResult };

  'memberships.getForTweet': { payload: TweetIdPayload; result: FolderId[] };
  'memberships.getCountsForTweets': { payload: TweetIdsPayload; result: MembershipCounts };
  'memberships.saveTweet': { payload: SaveTweetPayload; result: SaveTweetResult };
  'memberships.removeTweet': { payload: RemoveTweetPayload; result: RemoveTweetResult };
  'memberships.listFolderTweets': {
    payload: ListFolderTweetsPayload;
    result: ListFolderTweetsResult;
  };
  'tweets.refresh': { payload: RefreshTweetsPayload; result: RefreshTweetsResult };

  'meta.getRecentFolders': { payload: undefined; result: FolderId[] };
}

export type RpcMethod = keyof RpcMethods;
export type PayloadOf<M extends RpcMethod> = RpcMethods[M]['payload'];
export type ResultOf<M extends RpcMethod> = RpcMethods[M]['result'];

export const RPC_METHODS = [
  'health.ping',
  'folders.list',
  'folders.create',
  'folders.rename',
  'folders.setCollapsed',
  'folders.moveUp',
  'folders.moveDown',
  'folders.deletePreview',
  'folders.delete',
  'memberships.getForTweet',
  'memberships.getCountsForTweets',
  'memberships.saveTweet',
  'memberships.removeTweet',
  'memberships.listFolderTweets',
  'tweets.refresh',
  'meta.getRecentFolders',
] as const satisfies readonly RpcMethod[];

/** Envelope sent over `chrome.runtime.sendMessage`. */
export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  kind: 'xf:rpc';
  method: M;
  payload: PayloadOf<M>;
}

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; method?: unknown };
  return (
    candidate.kind === 'xf:rpc' &&
    typeof candidate.method === 'string' &&
    (RPC_METHODS as readonly string[]).includes(candidate.method)
  );
}

/* -------------------------------------------------------------------------- */
/* Change channel                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Written to `chrome.storage.local` after every committed write. Content scripts
 * observe it through `chrome.storage.onChanged`, which fires in every tab
 * without needing `tabs` or host permissions, and survives worker termination.
 */
export interface DatabaseChangedEvent {
  type: 'xf:database-changed';
  /** Monotonic per write; lets a listener ignore replays of its own revision. */
  revision: number;
  foldersChanged: boolean;
  affectedFolderIds: FolderId[];
  affectedTweetIds: TweetId[];
}

export function isDatabaseChangedEvent(value: unknown): value is DatabaseChangedEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; revision?: unknown };
  return candidate.type === 'xf:database-changed' && typeof candidate.revision === 'number';
}
