import {
  FOLDER_TWEETS_PAGE_SIZE,
  MEMBERSHIP_COUNT_BATCH_MAX,
  TWEET_TEXT_MAX,
} from '@/core/constants';
import { upgradeV1Row } from '@/core/domain/snapshot';
import { DomainError } from '@/core/errors/DomainError';
import type { TweetRecord } from '@/core/domain/tweet';
import type {
  CreateFolderPayload,
  FolderIdPayload,
  ListFolderTweetsPayload,
  PayloadOf,
  RemoveTweetPayload,
  RenameFolderPayload,
  RpcMethod,
  SaveTweetPayload,
  SetCollapsedPayload,
  TweetIdPayload,
  TweetIdsPayload,
} from './protocol';
import { isNumericTweetId, requireStatusUrl } from '@/utils/url';
import { trimTweetText } from '@/utils/text';

/**
 * The service worker never trusts a content-script payload: a compromised or
 * out-of-date page could send anything. Every field is checked here before it
 * reaches a repository, and validation failures become `INVALID_REQUEST`.
 */

function bad(what: string): never {
  throw new DomainError('INVALID_REQUEST', `请求参数不合法：${what}`);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad(what);
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') bad(what);
  return value;
}

function asFolderId(value: unknown, what: string): string {
  const id = asString(value, what);
  if (id.length === 0 || id.length > 64) bad(what);
  return id;
}

function asTweetId(value: unknown, what: string): string {
  const id = asString(value, what);
  if (!isNumericTweetId(id)) {
    throw new DomainError('INVALID_TWEET_ID', 'Tweet ID 必须是数字字符串。');
  }
  return id;
}

function asBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') bad(what);
  return value;
}

function asFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) bad(what);
  return value;
}

function validateTweetRecord(value: unknown): TweetRecord {
  const raw = asRecord(value, 'tweet');
  const tweetId = asTweetId(raw.tweetId, 'tweet.tweetId');
  // The URL is the single source of truth for identity: a mismatch between the
  // canonical URL and the id means the extractor produced an inconsistent record.
  const parsed = requireStatusUrl(asString(raw.canonicalUrl, 'tweet.canonicalUrl'));
  if (parsed.tweetId !== tweetId) {
    throw new DomainError('INVALID_TWEET_URL', 'Tweet ID 与链接不一致。');
  }
  const authorName = raw.authorName === null ? null : asString(raw.authorName, 'tweet.authorName');
  const now = Date.now();
  return upgradeV1Row({
    tweetId,
    canonicalUrl: parsed.canonicalUrl,
    // username comes from the URL, never from visible text.
    username: parsed.username,
    authorName: authorName === null ? null : authorName.slice(0, 128),
    text: trimTweetText(asString(raw.text, 'tweet.text'), TWEET_TEXT_MAX),
    capturedAt: typeof raw.capturedAt === 'number' && Number.isFinite(raw.capturedAt)
      ? raw.capturedAt
      : now,
    updatedAt: now,
  });
}

type Validator = (payload: unknown) => unknown;

const VALIDATORS: Record<RpcMethod, Validator> = {
  'health.ping': () => undefined,
  'folders.list': () => undefined,
  'meta.getRecentFolders': () => undefined,

  'folders.create': (payload): CreateFolderPayload => {
    const raw = asRecord(payload, 'payload');
    return {
      name: asString(raw.name, 'name'),
      parentId: raw.parentId === null ? null : asFolderId(raw.parentId, 'parentId'),
    };
  },

  'folders.rename': (payload): RenameFolderPayload => {
    const raw = asRecord(payload, 'payload');
    return {
      folderId: asFolderId(raw.folderId, 'folderId'),
      name: asString(raw.name, 'name'),
    };
  },

  'folders.setCollapsed': (payload): SetCollapsedPayload => {
    const raw = asRecord(payload, 'payload');
    return {
      folderId: asFolderId(raw.folderId, 'folderId'),
      collapsed: asBoolean(raw.collapsed, 'collapsed'),
    };
  },

  'folders.moveUp': (payload): FolderIdPayload => folderIdOnly(payload),
  'folders.moveDown': (payload): FolderIdPayload => folderIdOnly(payload),
  'folders.deletePreview': (payload): FolderIdPayload => folderIdOnly(payload),
  'folders.delete': (payload): FolderIdPayload => folderIdOnly(payload),

  'memberships.getForTweet': (payload): TweetIdPayload => {
    const raw = asRecord(payload, 'payload');
    return { tweetId: asTweetId(raw.tweetId, 'tweetId') };
  },

  'memberships.getCountsForTweets': (payload): TweetIdsPayload => {
    const raw = asRecord(payload, 'payload');
    if (!Array.isArray(raw.tweetIds)) bad('tweetIds');
    if (raw.tweetIds.length > MEMBERSHIP_COUNT_BATCH_MAX) bad('tweetIds 超过单批上限');
    return { tweetIds: raw.tweetIds.map((id) => asTweetId(id, 'tweetIds[]')) };
  },

  'memberships.saveTweet': (payload): SaveTweetPayload => {
    const raw = asRecord(payload, 'payload');
    return {
      folderId: asFolderId(raw.folderId, 'folderId'),
      tweet: validateTweetRecord(raw.tweet),
    };
  },

  'memberships.removeTweet': (payload): RemoveTweetPayload => {
    const raw = asRecord(payload, 'payload');
    return {
      folderId: asFolderId(raw.folderId, 'folderId'),
      tweetId: asTweetId(raw.tweetId, 'tweetId'),
    };
  },

  'memberships.listFolderTweets': (payload): ListFolderTweetsPayload => {
    const raw = asRecord(payload, 'payload');
    const limit = Math.min(
      Math.max(1, Math.trunc(asFiniteNumber(raw.limit, 'limit'))),
      FOLDER_TWEETS_PAGE_SIZE,
    );
    const base: ListFolderTweetsPayload = {
      folderId: asFolderId(raw.folderId, 'folderId'),
      limit,
    };
    if (raw.cursor === undefined || raw.cursor === null) return base;
    const cursor = asRecord(raw.cursor, 'cursor');
    return {
      ...base,
      cursor: {
        savedAt: asFiniteNumber(cursor.savedAt, 'cursor.savedAt'),
        tweetId: asTweetId(cursor.tweetId, 'cursor.tweetId'),
      },
    };
  },
};

function folderIdOnly(payload: unknown): FolderIdPayload {
  const raw = asRecord(payload, 'payload');
  return { folderId: asFolderId(raw.folderId, 'folderId') };
}

/** Validates and normalises a payload for `method`. Throws `DomainError`. */
export function validatePayload<M extends RpcMethod>(method: M, payload: unknown): PayloadOf<M> {
  return VALIDATORS[method](payload) as PayloadOf<M>;
}
