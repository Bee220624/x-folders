import { describe, expect, it } from 'vitest';
import { mergeSnapshot, sameSnapshot, segmentsToText, upgradeV1Row } from '@/core/domain/snapshot';
import type { MediaItem, QuotedPost, TweetRecord } from '@/core/domain/tweet';
import { tweetFixture } from '../helpers/db';

const PHOTO: MediaItem = { kind: 'photo', url: 'https://pbs.twimg.com/media/A?format=jpg&name=small', alt: null };

function cutShort(text: string): TweetRecord {
  return { ...tweetFixture('1', { text }), truncated: true };
}

describe('segmentsToText', () => {
  it('joins every kind of segment in order', () => {
    expect(
      segmentsToText([
        { kind: 'text', text: 'hi ' },
        { kind: 'mention', text: '@bob', username: 'bob' },
        { kind: 'text', text: ' ' },
        { kind: 'hashtag', text: '#AI', tag: 'AI' },
        { kind: 'emoji', text: '🎉' },
        { kind: 'link', text: 'example.com', url: 'https://t.co/x' },
      ]),
    ).toBe('hi @bob #AI🎉example.com');
  });
});

describe('upgradeV1Row', () => {
  it('fills the snapshot fields of a v1 row and keeps its text as one segment', () => {
    expect(
      upgradeV1Row({
        tweetId: '1',
        canonicalUrl: 'https://x.com/a/status/1',
        username: 'a',
        authorName: 'A',
        text: 'x\ny',
        capturedAt: 1,
        updatedAt: 2,
      }),
    ).toEqual({
      tweetId: '1',
      canonicalUrl: 'https://x.com/a/status/1',
      username: 'a',
      authorName: 'A',
      avatarUrl: null,
      verified: false,
      postedAt: null,
      text: 'x\ny',
      segments: [{ kind: 'text', text: 'x\ny' }],
      media: [],
      quote: null,
      card: null,
      truncated: false,
      capturedAt: 1,
      updatedAt: 2,
    });
  });

  it('changes nothing on a row that is already v2', () => {
    const row: TweetRecord = { ...tweetFixture('1'), media: [PHOTO], truncated: true };
    expect(upgradeV1Row(row)).toEqual(row);
  });
});

describe('mergeSnapshot', () => {
  it('replaces truncated text with the full text', () => {
    const merged = mergeSnapshot(cutShort('short'), tweetFixture('1', { text: 'short and then the rest' }));
    expect(merged.text).toBe('short and then the rest');
    expect(merged.truncated).toBe(false);
  });

  it('never trades full text for a truncated capture', () => {
    const merged = mergeSnapshot(tweetFixture('1', { text: 'the whole post' }), cutShort('the whole'));
    expect(merged.text).toBe('the whole post');
    expect(merged.truncated).toBe(false);
  });

  it('never wipes stored text with an empty capture', () => {
    expect(mergeSnapshot(tweetFixture('1', { text: 'kept' }), tweetFixture('1', { text: '' })).text).toBe('kept');
  });

  it('keeps pictures the newer capture has not loaded yet', () => {
    expect(mergeSnapshot({ ...tweetFixture('1'), media: [PHOTO] }, tweetFixture('1')).media).toEqual([PHOTO]);
  });

  it('takes the newest avatar and keeps the first capture time', () => {
    const existing: TweetRecord = {
      ...tweetFixture('1', { capturedAt: 5 }),
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/old_normal.jpg',
    };
    const incoming: TweetRecord = {
      ...tweetFixture('1', { capturedAt: 9 }),
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/new_normal.jpg',
      updatedAt: 10,
    };
    const merged = mergeSnapshot(existing, incoming);
    expect(merged.avatarUrl).toBe(incoming.avatarUrl);
    expect(merged.capturedAt).toBe(5);
    expect(merged.updatedAt).toBe(10);
  });

  it('keeps a quote link the newer capture could not see', () => {
    const quote: QuotedPost = {
      authorName: 'Q',
      username: 'q',
      verified: false,
      avatarUrl: null,
      postedAt: null,
      text: 'quoted',
      media: null,
      url: 'https://x.com/q/status/2',
    };
    const merged = mergeSnapshot({ ...tweetFixture('1'), quote }, { ...tweetFixture('1'), quote: { ...quote, url: null } });
    expect(merged.quote?.url).toBe('https://x.com/q/status/2');
  });
});

describe('sameSnapshot', () => {
  it('ignores updatedAt but sees any visible change', () => {
    const a = tweetFixture('1');
    expect(sameSnapshot(a, { ...a, updatedAt: a.updatedAt + 1 })).toBe(true);
    expect(sameSnapshot(a, { ...a, media: [PHOTO] })).toBe(false);
  });
});
