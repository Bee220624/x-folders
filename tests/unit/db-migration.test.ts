import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { SCHEMA_V1 } from '@/background/db/schema';
import { XFoldersDatabase } from '@/background/db/XFoldersDatabase';

describe('database v1 → v2', () => {
  it('upgrades stored posts in place and leaves folders and memberships alone', async () => {
    const name = `x-folders-migration-${Math.random().toString(36).slice(2)}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1.table('folders').add({
      id: 'f1',
      name: 'AI',
      parentId: null,
      position: 1000,
      collapsed: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await v1.table('tweets').bulkAdd([
      {
        tweetId: '1',
        canonicalUrl: 'https://x.com/alice/status/1',
        username: 'alice',
        authorName: 'Alice',
        text: 'hello\nworld',
        capturedAt: 5,
        updatedAt: 6,
      },
      {
        tweetId: '2',
        canonicalUrl: 'https://x.com/bob/status/2',
        username: 'bob',
        authorName: null,
        text: '',
        capturedAt: 7,
        updatedAt: 7,
      },
    ]);
    await v1.table('folderTweets').add({ folderId: 'f1', tweetId: '1', savedAt: 9 });
    v1.close();

    const db = new XFoldersDatabase(name);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.tweets.get('1')).toEqual({
      tweetId: '1',
      canonicalUrl: 'https://x.com/alice/status/1',
      username: 'alice',
      authorName: 'Alice',
      avatarUrl: null,
      verified: false,
      postedAt: null,
      text: 'hello\nworld',
      segments: [{ kind: 'text', text: 'hello\nworld' }],
      media: [],
      quote: null,
      card: null,
      truncated: false,
      capturedAt: 5,
      updatedAt: 6,
    });
    expect((await db.tweets.get('2'))?.segments).toEqual([]);
    expect(await db.folders.count()).toBe(1);
    expect(await db.folderTweets.get(['f1', '1'])).toEqual({ folderId: 'f1', tweetId: '1', savedAt: 9 });
    db.close();
  });
});
