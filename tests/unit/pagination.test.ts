import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderService } from '@/background/services/FolderService';
import { TweetSaveService } from '@/background/services/TweetSaveService';
import type { XFoldersDatabase } from '@/background/db/XFoldersDatabase';
import type { FolderTweetsCursor } from '@/core/domain/membership';
import { freshDatabase, tweetFixture } from '../helpers/db';

/** Walks every page and returns the ids in order, plus the page sizes seen. */
async function drain(
  tweets: TweetSaveService,
  folderId: string,
  limit: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: FolderTweetsCursor | undefined;
  let pages = 0;
  for (;;) {
    const payload =
      cursor === undefined ? { folderId, limit } : { folderId, limit, cursor };
    const page = await tweets.listFolderTweets(payload);
    pages += 1;
    ids.push(...page.items.map((item) => item.tweet.tweetId));
    if (page.nextCursor === null) return { ids, pages };
    cursor = page.nextCursor;
    if (pages > 200) throw new Error('pagination did not terminate');
  }
}

describe('folder tweet pagination', () => {
  let db: XFoldersDatabase;
  let folders: FolderService;
  let tweets: TweetSaveService;
  let clock: number;

  beforeEach(async () => {
    db = await freshDatabase();
    folders = new FolderService(db);
    tweets = new TweetSaveService(db);
    clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns newest first and pages without gaps or duplicates', async () => {
    const folder = await folders.create('AI', null);
    const expected: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      clock += 1;
      const id = String(1_000_000_000_000_000_000n + BigInt(i));
      await tweets.save(folder.id, tweetFixture(id));
      expected.unshift(id);
    }

    const { ids, pages } = await drain(tweets, folder.id, 50);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(120);
    expect(pages).toBe(3);
  });

  it('never loses or repeats rows that share a savedAt millisecond', async () => {
    const folder = await folders.create('AI', null);
    const saved: string[] = [];
    // Every save lands in the same millisecond: the common burst-save case, and
    // exactly what a savedAt-only cursor would silently drop.
    for (let i = 0; i < 25; i += 1) {
      const id = String(1_000_000_000_000_000_000n + BigInt(i));
      await tweets.save(folder.id, tweetFixture(id));
      saved.push(id);
    }

    const { ids } = await drain(tweets, folder.id, 10);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect([...ids].sort()).toEqual([...saved].sort());
    // Within one savedAt the order is the index order reversed: tweetId
    // descending by code unit. It must not be re-sorted numerically in JS.
    expect(ids).toEqual([...saved].sort().reverse());
  });

  it('handles a mix of tied and distinct timestamps', async () => {
    const folder = await folders.create('AI', null);
    const all: string[] = [];
    for (let group = 0; group < 5; group += 1) {
      clock += 1;
      for (let i = 0; i < 7; i += 1) {
        const id = String(1_000_000_000_000_000_000n + BigInt(group * 10 + i));
        await tweets.save(folder.id, tweetFixture(id));
        all.push(id);
      }
    }
    const { ids } = await drain(tweets, folder.id, 4);
    expect(ids).toHaveLength(35);
    expect(new Set(ids).size).toBe(35);
    expect([...ids].sort()).toEqual([...all].sort());
  });

  it('reports nextCursor null exactly when the list is exhausted', async () => {
    const folder = await folders.create('AI', null);
    for (let i = 0; i < 10; i += 1) {
      clock += 1;
      await tweets.save(folder.id, tweetFixture(String(1_000_000_000_000_000_000n + BigInt(i))));
    }
    const full = await tweets.listFolderTweets({ folderId: folder.id, limit: 10 });
    // A page that happens to be exactly `limit` long with nothing after it must
    // still terminate rather than asking for one more empty page.
    expect(full.items).toHaveLength(10);
    expect(full.nextCursor).toBeNull();

    const partial = await tweets.listFolderTweets({ folderId: folder.id, limit: 9 });
    expect(partial.nextCursor).not.toBeNull();
  });

  it('is empty for a folder with no saves', async () => {
    const folder = await folders.create('Empty', null);
    const page = await tweets.listFolderTweets({ folderId: folder.id, limit: 50 });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('skips a membership whose tweet row is missing without stalling paging', async () => {
    const folder = await folders.create('AI', null);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      clock += 1;
      const id = String(1_000_000_000_000_000_000n + BigInt(i));
      await tweets.save(folder.id, tweetFixture(id));
      ids.push(id);
    }
    // Simulate a tweet row lost to a concurrent GC while its membership remains.
    await db.tweets.delete(ids[2]!);

    const { ids: seen } = await drain(tweets, folder.id, 2);
    expect(seen).toHaveLength(4);
    expect(seen).not.toContain(ids[2]);
    expect(new Set(seen).size).toBe(4);
  });

  it('scopes pages to one folder', async () => {
    const a = await folders.create('A', null);
    const b = await folders.create('B', null);
    clock += 1;
    await tweets.save(a.id, tweetFixture('1000000000000000001'));
    clock += 1;
    await tweets.save(b.id, tweetFixture('1000000000000000002'));

    const pageA = await tweets.listFolderTweets({ folderId: a.id, limit: 50 });
    expect(pageA.items.map((i) => i.tweet.tweetId)).toEqual(['1000000000000000001']);
  });

  it('keeps cursor keys stable when a tweet is re-saved into the same folder', async () => {
    const folder = await folders.create('AI', null);
    for (let i = 0; i < 3; i += 1) {
      clock += 1;
      await tweets.save(folder.id, tweetFixture(String(1_000_000_000_000_000_000n + BigInt(i))));
    }
    const before = await drain(tweets, folder.id, 2);
    clock += 1000;
    // Re-saving must not move the row to the top: savedAt is immutable, which is
    // what keeps a reader's cursor valid mid-scroll.
    await tweets.save(folder.id, tweetFixture('1000000000000000000'));
    const after = await drain(tweets, folder.id, 2);
    expect(after.ids).toEqual(before.ids);
  });
});
