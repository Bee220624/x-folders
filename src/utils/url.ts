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

const IMAGE_HOST = 'pbs.twimg.com';

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Pictures are only ever loaded from X's image server (work order 3.2). */
export function isAllowedImageUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.hostname === IMAGE_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}

/** Links a post or card may carry: http(s) only, so never javascript:, data: or blob:. */
export function isAllowedLinkUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && (url.protocol === 'https:' || url.protocol === 'http:');
}

const AVATAR_SIZE = /_(?:normal|bigger|mini|x96|200x200|400x400)(\.\w+)$/;

/**
 * One stable URL per picture. The timeline asks for `name=small`, a post's own
 * page for `medium` or `large`; without this every page change would look like
 * new media and cause a pointless rewrite. Expects an allowed URL.
 */
export function normalizeImageUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  if (url.pathname.startsWith('/media/')) {
    const format = url.searchParams.get('format');
    url.search = '';
    if (format !== null) url.searchParams.set('format', format);
    url.searchParams.set('name', 'small');
  } else if (url.pathname.startsWith('/profile_images/')) {
    url.pathname = url.pathname.replace(AVATAR_SIZE, '_normal$1');
  }
  return url.toString();
}

/** A photo at the size a card needs; other kinds of picture come back unchanged. */
export function imageUrlForSize(raw: string, size: 'small' | 'medium'): string {
  const url = parseUrl(raw);
  if (url === null || !url.pathname.startsWith('/media/')) return raw;
  url.searchParams.set('name', size);
  return url.toString();
}

/** `_normal` is 48px and blurry at 40px on a 2x screen; `_bigger` is 73px. */
export function avatarUrlForDisplay(raw: string): string {
  return raw.replace(AVATAR_SIZE, '_bigger$1');
}
