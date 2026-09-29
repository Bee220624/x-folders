import { describe, expect, it } from 'vitest';
import { TWEET_TEXT_MAX } from '@/core/constants';
import { DomainError } from '@/core/errors/DomainError';
import { sanitizeSnapshot } from '@/messaging/sanitizeSnapshot';

const NOW = Date.UTC(2026, 8, 29);
const PHOTO = 'https://pbs.twimg.com/media/AbC?format=jpg&name=large';

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tweetId: '1234567890',
    canonicalUrl: 'https://twitter.com/alice/status/1234567890/photo/1',
    username: 'ignored',
    authorName: 'Alice',
    avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    verified: true,
    postedAt: Date.UTC(2026, 8, 28),
    text: 'ignored — rebuilt from the segments',
    segments: [
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', text: '@bob', username: 'bob' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'example.com/a', url: 'https://t.co/abc' },
      { kind: 'hashtag', text: '#AI', tag: 'AI' },
    ],
    media: [{ kind: 'photo', url: PHOTO, alt: '图像' }],
    quote: null,
    card: null,
    truncated: true,
    capturedAt: 5,
    ...overrides,
  };
}

describe('sanitizeSnapshot', () => {
  it('keeps a well-formed snapshot and rebuilds identity and text itself', () => {
    const record = sanitizeSnapshot(raw(), NOW);
    expect(record.canonicalUrl).toBe('https://x.com/alice/status/1234567890');
    expect(record.username).toBe('alice');
    expect(record.text).toBe('hi @bob example.com/a#AI');
    expect(record.media).toEqual([
      { kind: 'photo', url: 'https://pbs.twimg.com/media/AbC?format=jpg&name=small', alt: '图像' },
    ]);
    expect(record.verified).toBe(true);
    expect(record.truncated).toBe(true);
    expect(record.capturedAt).toBe(5);
    expect(record.updatedAt).toBe(NOW);
  });

  it('still rejects a record whose id and permalink disagree', () => {
    expect(() => sanitizeSnapshot(raw({ tweetId: '999' }), NOW)).toThrow(DomainError);
  });

  it('drops pictures from anywhere but pbs.twimg.com', () => {
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg';
    const record = sanitizeSnapshot(
      raw({
        avatarUrl: 'https://evil.example/a.jpg',
        media: [
          { kind: 'photo', url: 'https://evil.example/b.jpg', alt: null },
          { kind: 'video', url: poster, alt: null },
        ],
      }),
      NOW,
    );
    expect(record.avatarUrl).toBeNull();
    expect(record.media).toEqual([{ kind: 'video', url: poster, alt: null }]);
  });

  it('turns unsafe links and bad mentions into plain text instead of losing the words', () => {
    const record = sanitizeSnapshot(
      raw({
        segments: [
          { kind: 'link', text: 'click', url: 'javascript:alert(1)' },
          { kind: 'mention', text: '@not valid', username: 'not valid' },
          { kind: 'bogus', text: 'gone' },
        ],
      }),
      NOW,
    );
    expect(record.segments).toEqual([
      { kind: 'text', text: 'click' },
      { kind: 'text', text: '@not valid' },
    ]);
  });

  it('caps text, media and strings', () => {
    const record = sanitizeSnapshot(
      raw({
        authorName: 'n'.repeat(500),
        segments: [
          { kind: 'text', text: 'a'.repeat(TWEET_TEXT_MAX) },
          { kind: 'text', text: 'overflow' },
        ],
        media: Array.from({ length: 9 }, () => ({ kind: 'photo', url: PHOTO, alt: null })),
      }),
      NOW,
    );
    expect(record.authorName).toHaveLength(128);
    expect(record.text).toHaveLength(TWEET_TEXT_MAX);
    expect(record.media).toHaveLength(4);
  });

  it('drops an impossible post time', () => {
    expect(sanitizeSnapshot(raw({ postedAt: Date.UTC(2001, 0, 1) }), NOW).postedAt).toBeNull();
    expect(sanitizeSnapshot(raw({ postedAt: NOW + 7 * 86_400_000 }), NOW).postedAt).toBeNull();
    expect(sanitizeSnapshot(raw({ postedAt: 'yesterday' }), NOW).postedAt).toBeNull();
  });

  it('keeps a quote with a checked link and drops an empty one', () => {
    const quote = {
      authorName: 'Q',
      username: 'q_user',
      verified: false,
      avatarUrl: null,
      postedAt: null,
      text: 'quoted',
      media: null,
      url: 'https://x.com/q_user/status/42',
    };
    expect(sanitizeSnapshot(raw({ quote }), NOW).quote).toEqual(quote);
    expect(sanitizeSnapshot(raw({ quote: { ...quote, url: 'https://evil.example/q' } }), NOW).quote?.url).toBeNull();
    expect(
      sanitizeSnapshot(raw({ quote: { authorName: null, username: null, text: '', media: null } }), NOW).quote,
    ).toBeNull();
  });

  it('keeps a link card only with an http(s) link', () => {
    const card = {
      url: 'https://t.co/card',
      layout: 'small',
      title: 'A title',
      domain: 'example.com',
      imageUrl: 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=small',
    };
    expect(sanitizeSnapshot(raw({ card }), NOW).card).toEqual(card);
    expect(sanitizeSnapshot(raw({ card: { ...card, url: 'javascript:void 0' } }), NOW).card).toBeNull();
    expect(
      sanitizeSnapshot(raw({ card: { ...card, imageUrl: 'https://evil.example/c.jpg' } }), NOW).card?.imageUrl,
    ).toBeNull();
  });
});
