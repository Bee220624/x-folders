import { describe, expect, it } from 'vitest';
import { extractTweet, type ExtractOutcome } from '@/hosts/x/TweetExtractor';
import { cardHtml, mountPost, postHtml, quoteHtml } from '../helpers/postDom';

const NOW = 1_700_000_000_000;
const photo = (id: string): string => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;

function extract(html: string, pathname = '/home'): Extract<ExtractOutcome, { status: 'ok' }>['record'] {
  const outcome = extractTweet(mountPost(html), { pathname, now: NOW });
  if (outcome.status !== 'ok') throw new Error(`not extracted: ${outcome.reason}`);
  return outcome.record;
}

describe('extractTweet snapshot', () => {
  it('assembles everything a card shows', () => {
    const record = extract(
      postHtml({
        verified: true,
        textHtml: '<span>Hi </span><div><span><a href="/bob" role="link">@bob</a></span></div>',
        showMore: true,
        photos: [photo('P1')],
        cardHtml: cardHtml(),
        quoteHtml: quoteHtml({ photo: photo('Q1') }),
      }),
    );
    expect(record).toMatchObject({
      tweetId: '1234567890',
      canonicalUrl: 'https://x.com/alice/status/1234567890',
      authorName: 'Alice',
      verified: true,
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/alice_normal.jpg',
      postedAt: Date.UTC(2026, 8, 28, 10),
      text: 'Hi @bob',
      segments: [
        { kind: 'text', text: 'Hi ' },
        { kind: 'mention', text: '@bob', username: 'bob' },
      ],
      truncated: true,
      media: [{ kind: 'photo', url: photo('P1'), alt: '图像' }],
      card: { url: 'https://t.co/card', layout: 'large', domain: null, title: 'A card title' },
      quote: {
        authorName: 'Quoted Person',
        username: 'quoted',
        verified: false,
        avatarUrl: 'https://pbs.twimg.com/profile_images/2/quoted_normal.jpg',
        postedAt: Date.UTC(2026, 8, 27, 8),
        text: 'quoted words',
        media: { kind: 'photo', url: photo('Q1'), alt: '图像' },
        url: null,
      },
      capturedAt: NOW,
      updatedAt: NOW,
    });
  });

  it('fills the quote link when X renders a timestamped link inside it', () => {
    const record = extract(postHtml({ quoteHtml: quoteHtml({ linkId: '42' }) }));
    expect(record.quote?.url).toBe('https://x.com/quoted/status/42');
  });

  it('stores no quote picture for covered sensitive media', () => {
    expect(extract(postHtml({ quoteHtml: quoteHtml({ interstitial: true }) })).quote?.media).toBeNull();
  });

  it('reads the time of a post’s own page from its permalink row and marks nothing truncated', () => {
    const record = extract(postHtml({ focused: true }), '/alice/status/1234567890');
    expect(record.postedAt).toBe(Date.UTC(2026, 8, 28, 10));
    expect(record.truncated).toBe(false);
  });

  it('gives a media-only post empty text rather than the quote’s words', () => {
    const record = extract(postHtml({ textHtml: null, quoteHtml: quoteHtml() }));
    expect(record.text).toBe('');
    expect(record.segments).toEqual([]);
  });
});
