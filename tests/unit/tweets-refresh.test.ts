import { beforeEach, describe, expect, it } from 'vitest';
import type { XFoldersDatabase } from '@/background/db/XFoldersDatabase';
import { FolderService } from '@/background/services/FolderService';
import { TweetSaveService } from '@/background/services/TweetSaveService';
import { CHANGE_CHANNEL_KEY } from '@/core/constants';
import { freshDatabase, tweetFixture } from '../helpers/db';

async function lastChange(): Promise<unknown> {
  return (await chrome.storage.local.get(CHANGE_CHANNEL_KEY))[CHANGE_CHANNEL_KEY];
}

describe('TweetSaveService.refresh', () => {
  let db: XFoldersDatabase;
  let service: TweetSaveService;

  beforeEach(async () => {
    db = await freshDatabase();
    service = new TweetSaveService(db);
    const folder = await new FolderService(db).create('AI', null);
    await service.save(folder.id, { ...tweetFixture('1', { text: 'cut' }), truncated: true });
    await chrome.storage.local.set({ [CHANGE_CHANNEL_KEY]: null });
  });

  it('completes a saved post and tells the other pages', async () => {
    const result = await service.refresh([tweetFixture('1', { text: 'cut, then the whole post' })]);
    expect(result).toEqual({ updated: ['1'] });
    expect((await db.tweets.get('1'))?.text).toBe('cut, then the whole post');
    expect(await lastChange()).toMatchObject({ foldersChanged: false, affectedTweetIds: ['1'] });
  });

  it('ignores unsaved posts, and stays silent when nothing changed', async () => {
    const same = { ...tweetFixture('1', { text: 'cut' }), truncated: true };
    expect(await service.refresh([same, tweetFixture('2')])).toEqual({ updated: [] });
    expect(await db.tweets.get('2')).toBeUndefined();
    expect(await lastChange()).toBeNull();
  });
});
