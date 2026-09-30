import { describe, expect, it } from 'vitest';
import type { TweetRecord } from '@/core/domain/tweet';
import { extractTweet } from '@/hosts/x/TweetExtractor';
import { loadFixture, type FixtureName } from '../helpers/fixtures';

const NOW = Date.UTC(2026, 8, 30);

function records(name: FixtureName, pathname: string): TweetRecord[] {
  return loadFixture(name).tweets.flatMap((root) => {
    const outcome = extractTweet(root, { pathname, now: NOW });
    return outcome.status === 'ok' ? [outcome.record] : [];
  });
}

describe('snapshots from the 2026-09 captures', () => {
  const home = records('x-home-rich', '/home');

  it('reads an avatar, a name and a time for nearly every post', () => {
    expect(home.length).toBeGreaterThan(10);
    const complete = home.filter(
      (record) =>
        record.avatarUrl?.startsWith('https://pbs.twimg.com/profile_images/') === true &&
        record.authorName !== null &&
        record.postedAt !== null,
    );
    expect(complete.length / home.length).toBeGreaterThanOrEqual(0.8);
  });

  it('finds every kind of content the capture was required to cover', () => {
    expect(home.some((record) => record.media.some((item) => item.kind === 'photo'))).toBe(true);
    expect(home.some((record) => record.media.some((item) => item.kind === 'video'))).toBe(true);
    expect(home.some((record) => record.card?.url.startsWith('https://t.co/') === true)).toBe(true);
    expect(home.some((record) => record.quote !== null)).toBe(true);
    expect(home.some((record) => record.truncated)).toBe(true);
  });

  it('reads the domain of every large link card from the line X prints under it', () => {
    const large = home.flatMap((record) => (record.card?.layout === 'large' ? [record.card] : []));
    expect(large.length).toBeGreaterThan(0);
    expect(large.every((card) => card.domain === 'example.com')).toBe(true);
  });

  it('keeps quoted pictures out of the outer post', () => {
    for (const record of home) {
      const quoted = record.quote?.media?.url;
      if (quoted === undefined) continue;
      expect(record.media.map((item) => item.url)).not.toContain(quoted);
    }
  });

  it('finds the full text of a cut-short post on its own page', () => {
    const cut = home.find((record) => record.tweetId === '1000000000000000006');
    expect(cut?.truncated).toBe(true);
    if (cut === undefined) return;
    const own = records('x-status-long', `/${cut.username}/status/${cut.tweetId}`).find(
      (record) => record.tweetId === cut.tweetId,
    );
    expect(own?.truncated).toBe(false);
    expect(own?.text.length ?? 0).toBeGreaterThan(cut.text.length);
  });

  it('extracts the posts on the bookmarks page', () => {
    expect(records('x-bookmarks', '/i/bookmarks').length).toBeGreaterThan(0);
  });
});
