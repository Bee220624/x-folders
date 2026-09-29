export type TweetId = string;

/**
 * One run of post text. Stored instead of HTML, so nothing X rendered is ever
 * parsed again; the card rebuilds links from these fields alone.
 */
export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'mention'; text: string; username: string }
  | { kind: 'hashtag'; text: string; tag: string }
  | { kind: 'emoji'; text: string };

export type MediaKind = 'photo' | 'video' | 'gif';

export interface MediaItem {
  kind: MediaKind;
  /** The picture, or the poster frame of a video or GIF. pbs.twimg.com only. */
  url: string;
  alt: string | null;
}

export interface QuotedPost {
  authorName: string | null;
  /** From the quote's visible @handle: X renders the quote block without a profile link. */
  username: string | null;
  verified: boolean;
  avatarUrl: string | null;
  postedAt: number | null;
  text: string;
  /** The first picture only — enough to recognise the quote. */
  media: MediaItem | null;
  /** Only when the page exposes it; on 2026-09-29 the quote block carried no link. */
  url: string | null;
}

export interface LinkCard {
  url: string;
  layout: 'large' | 'small';
  title: string | null;
  domain: string | null;
  imageUrl: string | null;
}

/** A saved post: identity plus everything its card shows (work order 3.2). */
export interface TweetRecord {
  tweetId: TweetId;
  /** Always `https://x.com/{username}/status/{tweetId}`. */
  canonicalUrl: string;
  username: string;
  authorName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  /** From the post's own `<time datetime>`; null when the page had not rendered it. */
  postedAt: number | null;
  /** Plain text for search — always the concatenation of `segments`. */
  text: string;
  segments: TextSegment[];
  media: MediaItem[];
  quote: QuotedPost | null;
  card: LinkCard | null;
  /** The timeline cut the text short ("Show more"); a later full view replaces it. */
  truncated: boolean;
  capturedAt: number;
  updatedAt: number;
}
