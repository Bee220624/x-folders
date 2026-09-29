import { TWEET_TEXT_MAX } from '@/core/constants';
import { segmentsToText } from '@/core/domain/snapshot';
import type { LinkCard, MediaItem, MediaKind, QuotedPost, TextSegment, TweetRecord } from '@/core/domain/tweet';
import { DomainError } from '@/core/errors/DomainError';
import {
  isAllowedImageUrl,
  isAllowedLinkUrl,
  isNumericTweetId,
  normalizeImageUrl,
  parseStatusUrl,
  requireStatusUrl,
} from '@/utils/url';

/** Generous for real posts, small enough that a hostile page cannot bloat the database. */
export const SNAPSHOT_LIMITS = {
  name: 128,
  url: 2048,
  alt: 1000,
  cardTitle: 300,
  domain: 253,
  tag: 140,
  segments: 2000,
  media: 4,
} as const;

/** X launched on 2006-03-21; anything earlier, or more than a day ahead, is not a post time. */
const EARLIEST_POST = Date.UTC(2006, 2, 21);
const DAY_MS = 86_400_000;
const USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const MEDIA_KINDS: ReadonlySet<string> = new Set<MediaKind>(['photo', 'video', 'gif']);

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capped(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > SNAPSHOT_LIMITS.url) return null;
  return isAllowedImageUrl(value) ? normalizeImageUrl(value) : null;
}

function linkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > SNAPSHOT_LIMITS.url) return null;
  return isAllowedLinkUrl(value) ? value : null;
}

function username(value: unknown): string | null {
  return typeof value === 'string' && USERNAME.test(value) ? value : null;
}

function postTime(value: unknown, now: number): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= EARLIEST_POST &&
    value <= now + DAY_MS
    ? Math.trunc(value)
    : null;
}

/** Unknown kinds are dropped; a link or mention that fails its check keeps its words as text. */
function segment(value: unknown): TextSegment | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const text = value.text;
  switch (value.kind) {
    case 'text':
      return { kind: 'text', text };
    case 'emoji':
      return { kind: 'emoji', text };
    case 'link': {
      const url = linkUrl(value.url);
      return url === null ? { kind: 'text', text } : { kind: 'link', text, url };
    }
    case 'mention': {
      const name = username(value.username);
      return name === null ? { kind: 'text', text } : { kind: 'mention', text, username: name };
    }
    case 'hashtag': {
      const tag = capped(value.tag, SNAPSHOT_LIMITS.tag);
      return tag === null || tag.length === 0 ? { kind: 'text', text } : { kind: 'hashtag', text, tag };
    }
    default:
      return null;
  }
}

/** The total text is capped at TWEET_TEXT_MAX by cutting the segment that crosses it. */
function segments(value: unknown): TextSegment[] {
  if (!Array.isArray(value)) return [];
  const out: TextSegment[] = [];
  let budget = TWEET_TEXT_MAX;
  for (const item of value.slice(0, SNAPSHOT_LIMITS.segments)) {
    if (budget <= 0) break;
    const next = segment(item);
    if (next === null || next.text.length === 0) continue;
    const text = next.text.length > budget ? next.text.slice(0, budget) : next.text;
    budget -= text.length;
    out.push({ ...next, text });
  }
  return out;
}

function mediaItem(value: unknown): MediaItem | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || !MEDIA_KINDS.has(value.kind)) return null;
  const url = imageUrl(value.url);
  if (url === null) return null;
  return { kind: value.kind as MediaKind, url, alt: capped(value.alt, SNAPSHOT_LIMITS.alt) };
}

function mediaList(value: unknown): MediaItem[] {
  if (!Array.isArray(value)) return [];
  const out: MediaItem[] = [];
  for (const item of value.slice(0, SNAPSHOT_LIMITS.media * 4)) {
    const media = mediaItem(item);
    if (media !== null) out.push(media);
    if (out.length === SNAPSHOT_LIMITS.media) break;
  }
  return out;
}

function quote(value: unknown, now: number): QuotedPost | null {
  if (!isRecord(value)) return null;
  const parsed = typeof value.url === 'string' ? parseStatusUrl(value.url) : null;
  const result: QuotedPost = {
    authorName: capped(value.authorName, SNAPSHOT_LIMITS.name),
    username: username(value.username),
    verified: value.verified === true,
    avatarUrl: imageUrl(value.avatarUrl),
    postedAt: postTime(value.postedAt, now),
    text: (capped(value.text, TWEET_TEXT_MAX) ?? '').trim(),
    media: mediaItem(value.media),
    url: parsed === null ? null : parsed.canonicalUrl,
  };
  const empty =
    result.authorName === null && result.username === null && result.text.length === 0 && result.media === null;
  return empty ? null : result;
}

function card(value: unknown): LinkCard | null {
  if (!isRecord(value)) return null;
  const url = linkUrl(value.url);
  if (url === null) return null;
  return {
    url,
    layout: value.layout === 'small' ? 'small' : 'large',
    title: capped(value.title, SNAPSHOT_LIMITS.cardTitle),
    domain: capped(value.domain, SNAPSHOT_LIMITS.domain),
    imageUrl: imageUrl(value.imageUrl),
  };
}

/**
 * Turns an untrusted snapshot from a content script into a storable record.
 *
 * Identity is strict: a bad id or permalink rejects the request, because a
 * record under the wrong key cannot be repaired later. Everything else is
 * forgiving: a field that fails its check is dropped, so one odd picture never
 * stops a save. `username` comes from the permalink and `text` from the
 * segments; neither is taken from the payload.
 */
export function sanitizeSnapshot(value: unknown, now: number): TweetRecord {
  if (!isRecord(value)) throw new DomainError('INVALID_REQUEST', '请求参数不合法：tweet');
  if (typeof value.tweetId !== 'string' || !isNumericTweetId(value.tweetId)) {
    throw new DomainError('INVALID_TWEET_ID', 'Tweet ID 必须是数字字符串。');
  }
  if (typeof value.canonicalUrl !== 'string') {
    throw new DomainError('INVALID_REQUEST', '请求参数不合法：tweet.canonicalUrl');
  }
  const parsed = requireStatusUrl(value.canonicalUrl);
  if (parsed.tweetId !== value.tweetId) {
    throw new DomainError('INVALID_TWEET_URL', 'Tweet ID 与链接不一致。');
  }

  const text = segments(value.segments);
  return {
    tweetId: parsed.tweetId,
    canonicalUrl: parsed.canonicalUrl,
    username: parsed.username,
    authorName: capped(value.authorName, SNAPSHOT_LIMITS.name),
    avatarUrl: imageUrl(value.avatarUrl),
    verified: value.verified === true,
    postedAt: postTime(value.postedAt, now),
    text: segmentsToText(text),
    segments: text,
    media: mediaList(value.media),
    quote: quote(value.quote, now),
    card: card(value.card),
    truncated: value.truncated === true,
    capturedAt:
      typeof value.capturedAt === 'number' && Number.isFinite(value.capturedAt) ? value.capturedAt : now,
    updatedAt: now,
  };
}
