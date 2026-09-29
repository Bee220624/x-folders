import { describe, expect, it } from 'vitest';
import { TweetRepository } from '@/background/repositories/TweetRepository';
import { freshDatabase, tweetFixture } from '../helpers/db';

describe('TweetRepository snapshots', () => {
  it('completes a truncated post on re-save and never degrades it back', async () => {
    const db = await freshDatabase();
    const repository = new TweetRepository(db);
    await repository.upsert({ ...tweetFixture('1', { text: 'the start' }), truncated: true });
    await repository.upsert(tweetFixture('1', { text: 'the start and the end' }));
    await repository.upsert({ ...tweetFixture('1', { text: 'the start' }), truncated: true });
    const stored = await repository.get('1');
    expect(stored?.text).toBe('the start and the end');
    expect(stored?.truncated).toBe(false);
    db.close();
  });

  it('refresh never creates a row and skips writes that change nothing', async () => {
    const db = await freshDatabase();
    const repository = new TweetRepository(db);
    expect(await repository.refresh(tweetFixture('1'))).toBeNull();
    expect(await repository.get('1')).toBeUndefined();

    await repository.upsert(tweetFixture('1'));
    expect(await repository.refresh({ ...tweetFixture('1'), updatedAt: 99 })).toBeNull();
    const refreshed = await repository.refresh({ ...tweetFixture('1'), verified: true });
    expect(refreshed?.verified).toBe(true);
    expect((await repository.get('1'))?.verified).toBe(true);
    db.close();
  });
});
