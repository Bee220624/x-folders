import type { QuotedPost, TextSegment, TweetId, TweetRecord } from './tweet';

/** A version-1 row: identity and plain text only. */
export interface TweetRecordV1 {
  tweetId: TweetId;
  canonicalUrl: string;
  authorName: string | null;
  username: string;
  text: string;
  capturedAt: number;
  updatedAt: number;
}

/** Plain text for search is always derived from the segments, never sent separately. */
export function segmentsToText(segments: readonly TextSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

/**
 * Completes a row written before snapshots existed. Fields already present
 * are kept, so running it twice — or on a row that is already v2 — changes
 * nothing.
 */
export function upgradeV1Row(row: TweetRecordV1 & Partial<TweetRecord>): TweetRecord {
  return {
    tweetId: row.tweetId,
    canonicalUrl: row.canonicalUrl,
    username: row.username,
    authorName: row.authorName,
    avatarUrl: row.avatarUrl ?? null,
    verified: row.verified ?? false,
    postedAt: row.postedAt ?? null,
    text: row.text,
    segments: row.segments ?? (row.text.length > 0 ? [{ kind: 'text', text: row.text }] : []),
    media: row.media ?? [],
    quote: row.quote ?? null,
    card: row.card ?? null,
    truncated: row.truncated ?? false,
    capturedAt: row.capturedAt,
    updatedAt: row.updatedAt,
  };
}

function mergeQuote(existing: QuotedPost | null, incoming: QuotedPost | null): QuotedPost | null {
  if (incoming === null) return existing;
  if (existing === null) return incoming;
  return {
    ...incoming,
    avatarUrl: incoming.avatarUrl ?? existing.avatarUrl,
    postedAt: incoming.postedAt ?? existing.postedAt,
    media: incoming.media ?? existing.media,
    url: incoming.url ?? existing.url,
  };
}

/**
 * Folds a fresh capture into the stored snapshot.
 *
 * The page never shows everything at once — the timeline cuts long posts
 * short, pictures and avatars load lazily, a half-rendered row has no header
 * yet — so a newer capture is not automatically a better one. Each field keeps
 * the more complete value:
 *  - text: a full capture replaces a truncated one, never the reverse, and an
 *    empty capture never wipes stored text;
 *  - author: the newest non-empty value (avatars move to new URLs);
 *  - media: the newer list unless it has fewer items (not loaded yet);
 *  - quote, card: the newest when present, otherwise kept.
 * `capturedAt` is the first capture and never moves.
 */
export function mergeSnapshot(existing: TweetRecord, incoming: TweetRecord): TweetRecord {
  const keepText =
    (incoming.truncated && !existing.truncated) ||
    (incoming.segments.length === 0 && existing.segments.length > 0);
  const headerRendered = incoming.authorName !== null;
  return {
    ...existing,
    canonicalUrl: incoming.canonicalUrl,
    username: incoming.username,
    authorName: incoming.authorName ?? existing.authorName,
    avatarUrl: incoming.avatarUrl ?? existing.avatarUrl,
    verified: headerRendered ? incoming.verified : existing.verified,
    postedAt: incoming.postedAt ?? existing.postedAt,
    text: keepText ? existing.text : incoming.text,
    segments: keepText ? existing.segments : incoming.segments,
    truncated: keepText ? existing.truncated : incoming.truncated,
    media: incoming.media.length >= existing.media.length ? incoming.media : existing.media,
    quote: mergeQuote(existing.quote, incoming.quote),
    card: incoming.card ?? existing.card,
    capturedAt: existing.capturedAt,
    updatedAt: incoming.updatedAt,
  };
}

/** True when two snapshots would render the same; `updatedAt` is ignored. */
export function sameSnapshot(a: TweetRecord, b: TweetRecord): boolean {
  return JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));
}

/**
 * Nested objects are compared by serialisation. Every one of them is built by
 * sanitizeSnapshot in a fixed key order and survives IndexedDB's structured
 * clone unchanged, so equal content always serialises identically.
 */
function contentOf(record: TweetRecord): unknown[] {
  return [
    record.canonicalUrl,
    record.authorName,
    record.avatarUrl,
    record.verified,
    record.postedAt,
    record.segments,
    record.media,
    record.quote,
    record.card,
    record.truncated,
  ];
}
