import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderService } from '@/background/services/FolderService';
import { TweetSaveService } from '@/background/services/TweetSaveService';
import type { XFoldersDatabase } from '@/background/db/XFoldersDatabase';
import { DomainError } from '@/core/errors/DomainError';
import { freshDatabase, tweetFixture } from '../helpers/db';

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    return `UNEXPECTED:${String(error)}`;
  }
  return 'NO_THROW';
}

describe('memberships', () => {
  let db: XFoldersDatabase;
  let folders: FolderService;
  let tweets: TweetSaveService;

  beforeEach(async () => {
    db = await freshDatabase();
    folders = new FolderService(db);
    tweets = new TweetSaveService(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves a tweet into a folder', async () => {
    const folder = await folders.create('AI', null);
    const result = await tweets.save(folder.id, tweetFixture('1001'));
    expect(result.alreadyExists).toBe(false);
    expect(result.membershipCount).toBe(1);
    expect(await db.tweets.get('1001')).toBeDefined();
  });

  it('is idempotent on repeat save and preserves the original savedAt', async () => {
    const folder = await folders.create('AI', null);
    const first = await tweets.save(folder.id, tweetFixture('1001'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await tweets.save(folder.id, tweetFixture('1001'));

    expect(second.alreadyExists).toBe(true);
    expect(second.savedAt).toBe(first.savedAt);
    expect(second.membershipCount).toBe(1);
    expect(await db.folderTweets.count()).toBe(1);
  });

  it('stores the same tweet in two folders independently', async () => {
    const a = await folders.create('AI', null);
    const b = await folders.create('Investing', null);
    await tweets.save(a.id, tweetFixture('1001'));
    const second = await tweets.save(b.id, tweetFixture('1001'));

    expect(second.membershipCount).toBe(2);
    expect((await tweets.folderIdsForTweet('1001')).sort()).toEqual([a.id, b.id].sort());
  });

  it('removing one membership keeps the tweet and the other membership', async () => {
    const a = await folders.create('AI', null);
    const b = await folders.create('Investing', null);
    await tweets.save(a.id, tweetFixture('1001'));
    await tweets.save(b.id, tweetFixture('1001'));

    const removed = await tweets.remove(a.id, '1001');
    expect(removed.tweetDeleted).toBe(false);
    expect(removed.membershipCount).toBe(1);
    expect(await db.tweets.get('1001')).toBeDefined();
  });

  it('garbage-collects the tweet when its last membership goes', async () => {
    const folder = await folders.create('AI', null);
    await tweets.save(folder.id, tweetFixture('1001'));
    const removed = await tweets.remove(folder.id, '1001');
    expect(removed.tweetDeleted).toBe(true);
    expect(removed.membershipCount).toBe(0);
    expect(await db.tweets.get('1001')).toBeUndefined();
  });

  it('reports MEMBERSHIP_NOT_FOUND when removing something that is not there', async () => {
    const folder = await folders.create('AI', null);
    expect(await codeOf(() => tweets.remove(folder.id, '1001'))).toBe('MEMBERSHIP_NOT_FOUND');
  });

  it('deleting a folder removes only its own memberships', async () => {
    const a = await folders.create('AI', null);
    const b = await folders.create('Investing', null);
    await tweets.save(a.id, tweetFixture('1001'));
    await tweets.save(b.id, tweetFixture('1001'));
    await tweets.save(a.id, tweetFixture('1002'));

    const result = await folders.delete(a.id);
    expect(result.deletedMemberships).toBe(2);
    // 1001 survives in Investing; 1002 was only in AI and is collected.
    expect(result.deletedTweets).toBe(1);
    expect(await db.tweets.get('1001')).toBeDefined();
    expect(await db.tweets.get('1002')).toBeUndefined();
  });

  it('deleting a parent cascades to children and their memberships', async () => {
    const root = await folders.create('AI', null);
    const child = await folders.create('Agent', root.id);
    await tweets.save(child.id, tweetFixture('1001'));

    const result = await folders.delete(root.id);
    expect(result.deletedFolderIds).toHaveLength(2);
    expect(result.deletedMemberships).toBe(1);
    expect(result.deletedTweets).toBe(1);
    expect(await db.folders.count()).toBe(0);
    expect(await db.folderTweets.count()).toBe(0);
    expect(await db.tweets.count()).toBe(0);
  });

  it('previews a delete with descendant and membership counts', async () => {
    const root = await folders.create('AI', null);
    const child = await folders.create('Agent', root.id);
    await tweets.save(root.id, tweetFixture('1001'));
    await tweets.save(child.id, tweetFixture('1002'));

    const preview = await folders.deletePreview(root.id);
    expect(preview.name).toBe('AI');
    expect(preview.descendantCount).toBe(1);
    expect(preview.membershipCount).toBe(2);
  });

  it('keeps recent folders de-duplicated, most-recent-first and capped at 3', async () => {
    const created = [];
    for (const name of ['A', 'B', 'C', 'D']) {
      created.push(await folders.create(name, null));
    }
    for (const [index, folder] of created.entries()) {
      await tweets.save(folder.id, tweetFixture(`100${index + 1}`));
    }
    // Re-saving into A must move it to the front rather than duplicating it.
    await tweets.save(created[0]!.id, tweetFixture('1005'));

    const recent = await tweets.recentFolderIds();
    expect(recent).toHaveLength(3);
    expect(recent[0]).toBe(created[0]!.id);
    expect(new Set(recent).size).toBe(3);
  });

  it('drops deleted folders out of the recent list', async () => {
    const a = await folders.create('A', null);
    await tweets.save(a.id, tweetFixture('1001'));
    expect(await tweets.recentFolderIds()).toContain(a.id);
    await folders.delete(a.id);
    expect(await tweets.recentFolderIds()).not.toContain(a.id);
  });

  it('returns a count for every requested tweet id, including zeroes', async () => {
    const folder = await folders.create('AI', null);
    await tweets.save(folder.id, tweetFixture('1001'));
    const counts = await tweets.countsForTweets(['1001', '1002']);
    expect(counts).toEqual({ '1001': 1, '1002': 0 });
    expect(Object.keys(counts)).toHaveLength(2);
  });

  it('merges tweet metadata instead of clobbering it', async () => {
    const folder = await folders.create('AI', null);
    await tweets.save(folder.id, tweetFixture('1001', { text: 'full text', authorName: 'Alice' }));
    // A later half-rendered capture must not wipe the text or the author.
    await tweets.save(folder.id, tweetFixture('1001', { text: '', authorName: null }));

    const stored = await db.tweets.get('1001');
    expect(stored?.text).toBe('full text');
    expect(stored?.authorName).toBe('Alice');
    expect(stored?.capturedAt).toBe(1_700_000_000_000);
  });
});
