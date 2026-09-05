import { DomainError } from '@/core/errors/DomainError';
import type { TweetId } from '@/core/domain/tweet';

/**
 * Accepts only x.com / twitter.com status permalinks. Deliberately unanchored at
 * the end so `/analytics`, `/quotes`, `/photo/1` and query strings are ignored
 * rather than rejected — X puts all of those on real permalinks.
 */
const STATUS_URL =
  /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:[/?#]|$)/;

export interface ParsedStatusUrl {
  username: string;
  tweetId: TweetId;
  canonicalUrl: string;
}

/** Returns null for anything that is not a well-formed status permalink. */
export function parseStatusUrl(raw: string): ParsedStatusUrl | null {
  const match = STATUS_URL.exec(raw);
  if (match === null) return null;
  const username = match[1];
  const tweetId = match[2];
  if (username === undefined || tweetId === undefined) return null;
  // A leading zero would let two different strings denote the same id.
  if (tweetId.length > 1 && tweetId.startsWith('0')) return null;
  return {
    username,
    tweetId,
    canonicalUrl: `https://x.com/${username}/status/${tweetId}`,
  };
}

/** Throwing variant for the write path, where a bad URL must not be stored. */
export function requireStatusUrl(raw: string): ParsedStatusUrl {
  const parsed = parseStatusUrl(raw);
  if (parsed === null) {
    throw new DomainError('INVALID_TWEET_URL', '链接不是有效的 X 帖子地址。');
  }
  return parsed;
}

export function isNumericTweetId(value: string): boolean {
  return /^\d{1,25}$/.test(value) && (value.length === 1 || !value.startsWith('0'));
}

/**
 * Guards every href the UI renders. Only same-site X links are ever navigated
 * to, which rules out `javascript:`, `data:` and third-party redirects.
 */
export function isSafeXUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return url.hostname === 'x.com' || url.hostname === 'www.x.com' || url.hostname === 'twitter.com';
}
