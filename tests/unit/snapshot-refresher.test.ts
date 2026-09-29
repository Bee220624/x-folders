import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TweetRecord } from '@/core/domain/tweet';
import { SnapshotRefresher } from '@/hosts/x/SnapshotRefresher';
import { tweetFixture } from '../helpers/db';

describe('SnapshotRefresher', () => {
  let sent: TweetRecord[][];
  let refresher: SnapshotRefresher;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    refresher = new SnapshotRefresher(async (records) => {
      sent.push(records);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges sightings into one message', async () => {
    refresher.offer(tweetFixture('1'));
    refresher.offer(tweetFixture('2'));
    await vi.runAllTimersAsync();
    expect(sent.map((batch) => batch.map((record) => record.tweetId))).toEqual([['1', '2']]);
  });

  it('sends a post again only when the page shows more of it', async () => {
    const cut = { ...tweetFixture('1', { text: 'cut' }), truncated: true };
    refresher.offer(cut);
    await vi.runAllTimersAsync();
    refresher.offer(cut);
    await vi.runAllTimersAsync();
    refresher.offer(tweetFixture('1', { text: 'cut, then the whole post' }));
    await vi.runAllTimersAsync();
    expect(sent.map((batch) => batch.map((record) => record.truncated))).toEqual([[true], [false]]);
  });

  it('splits a burst into capped batches', async () => {
    for (let index = 1; index <= 25; index += 1) refresher.offer(tweetFixture(String(index)));
    await vi.runAllTimersAsync();
    expect(sent.map((batch) => batch.length)).toEqual([20, 5]);
  });
});
