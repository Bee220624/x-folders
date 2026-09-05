import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderService } from '@/background/services/FolderService';
import { TweetSaveService } from '@/background/services/TweetSaveService';
import { buildFolderTree, flattenTree } from '@/core/domain/folder';
import type { FolderTweetsCursor } from '@/core/domain/membership';
import { DomainError } from '@/core/errors/DomainError';
import { freshDatabase, tweetFixture } from '../helpers/db';

const SEEDS = 8;
const STEPS = 150;
/** Page sizes to exercise; 1 and 2 are where off-by-one cursor bugs surface. */
const PAGE_LIMITS = [1, 2, 3, 7, 50] as const;

/** Deterministic PRNG so a failure is reproducible from its seed alone. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Property test over the domain layer.
 *
 * Random folder/membership operations are mirrored in an in-memory model, and
 * after every step the database is checked against it. The invariants worth the
 * runtime are the ones unit tests state one case at a time: no dangling or
 * orphaned rows, sibling positions stay distinct, the tree never loses a folder,
 * counts agree, and — the reason this exists — a full paginated walk at five
 * different page sizes returns each membership exactly once and terminates.
 *
 * Each seed gets its OWN database. Sharing one across seeds while resetting the
 * model is a harness bug that reports every earlier seed's folders as a
 * mismatch.
 */
describe('domain fuzz', () => {
  afterEach(() => vi.restoreAllMocks());

  it('holds its invariants under random operation sequences', async () => {
    const problems: string[] = [];

    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const db = await freshDatabase();
      const folders = new FolderService(db);
      const tweets = new TweetSaveService(db);

      let clock = 1_700_000_000_000;
      const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);

      const rnd = mulberry32(seed);
      const pick = <T,>(items: readonly T[]): T | undefined =>
        items.length === 0 ? undefined : items[Math.floor(rnd() * items.length)];

      /** folderId -> the tweetIds it should contain. */
      const model = new Map<string, Set<string>>();
      const parentOf = new Map<string, string | null>();
      let nameCounter = 0;
      const note = (step: number, message: string): void => {
        problems.push(`seed${seed} step${step} ${message}`);
      };

      for (let step = 0; step < STEPS; step += 1) {
        const ids = [...model.keys()];
        const roots = ids.filter((id) => parentOf.get(id) === null);
        const op = rnd();

        try {
          if (op < 0.16 || ids.length === 0) {
            // Parents are always roots, so the two-level rule is never violated
            // by construction — a MAX_DEPTH here would be a real defect.
            const parent = rnd() < 0.4 ? (pick(roots) ?? null) : null;
            nameCounter += 1;
            const folder = await folders.create(`f${nameCounter}`, parent);
            model.set(folder.id, new Set());
            parentOf.set(folder.id, parent);
          } else if (op < 0.24) {
            nameCounter += 1;
            await folders.rename(pick(ids)!, `f${nameCounter}`);
          } else if (op < 0.32) {
            await folders.move(pick(ids)!, rnd() < 0.5 ? -1 : 1);
          } else if (op < 0.4) {
            const target = pick(ids)!;
            const subtree = [target, ...ids.filter((id) => parentOf.get(id) === target)];
            const result = await folders.delete(target);
            expect([...result.deletedFolderIds].sort()).toEqual([...subtree].sort());
            for (const id of subtree) {
              model.delete(id);
              parentOf.delete(id);
            }
          } else if (op < 0.75) {
            const target = pick(ids)!;
            // Half the saves share a millisecond, which is what makes the
            // savedAt ties in pagination real rather than theoretical.
            clock += rnd() < 0.5 ? 0 : 1;
            const tweetId = String(1_000_000_000_000_000_000n + BigInt(Math.floor(rnd() * 40)));
            await tweets.save(target, tweetFixture(tweetId));
            model.get(target)?.add(tweetId);
          } else {
            const target = pick(ids)!;
            const tweetId = pick([...(model.get(target) ?? [])]);
            if (tweetId !== undefined) {
              await tweets.remove(target, tweetId);
              model.get(target)?.delete(tweetId);
            }
          }
        } catch (error) {
          // The model is meant to keep every operation legal. A domain error
          // here means the model and the service disagree about what is legal.
          if (error instanceof DomainError) note(step, `unexpected ${error.code}`);
          else throw error;
        }

        const memberships = await db.folderTweets.toArray();
        const storedTweets = await db.tweets.toArray();
        const storedFolders = await db.folders.toArray();

        for (const membership of memberships) {
          if (!storedFolders.some((f) => f.id === membership.folderId)) {
            note(step, `dangling membership -> folder ${membership.folderId}`);
          }
          if (!storedTweets.some((t) => t.tweetId === membership.tweetId)) {
            note(step, `dangling membership -> tweet ${membership.tweetId}`);
          }
        }
        for (const tweet of storedTweets) {
          if (!memberships.some((m) => m.tweetId === tweet.tweetId)) {
            note(step, `orphan tweet ${tweet.tweetId}`);
          }
        }
        for (const [folderId, expected] of model) {
          const actual = new Set(
            memberships.filter((m) => m.folderId === folderId).map((m) => m.tweetId),
          );
          if (actual.size !== expected.size || [...expected].some((id) => !actual.has(id))) {
            note(step, `membership mismatch in ${folderId}`);
          }
        }
        if (storedFolders.length !== model.size) {
          note(step, `folder count ${storedFolders.length} != model ${model.size}`);
        }

        const positionsByParent = new Map<string, number[]>();
        for (const folder of storedFolders) {
          if (!Number.isFinite(folder.position)) note(step, `non-finite position ${folder.id}`);
          const key = folder.parentId ?? '#root';
          positionsByParent.set(key, [...(positionsByParent.get(key) ?? []), folder.position]);
        }
        for (const [parent, positions] of positionsByParent) {
          if (new Set(positions).size !== positions.length) {
            note(step, `duplicate sibling positions under ${parent}`);
          }
        }

        const snapshot = await folders.snapshot();
        if (flattenTree(buildFolderTree(snapshot.folders)).length !== storedFolders.length) {
          note(step, 'tree lost a folder');
        }
        for (const folder of snapshot.folders) {
          const expected = memberships.filter((m) => m.folderId === folder.id).length;
          if (folder.tweetCount !== expected) {
            note(step, `count mismatch ${folder.id}: ${folder.tweetCount} != ${expected}`);
          }
        }
        for (const recentId of await tweets.recentFolderIds()) {
          if (!storedFolders.some((f) => f.id === recentId)) {
            note(step, `recent list references deleted folder ${recentId}`);
          }
        }
      }

      // A full paginated walk must reproduce the membership set exactly, at
      // every page size, and terminate.
      for (const folderId of model.keys()) {
        for (const limit of PAGE_LIMITS) {
          const seen: string[] = [];
          let cursor: FolderTweetsCursor | undefined;
          let guard = 0;
          for (;;) {
            const page = await tweets.listFolderTweets(
              cursor === undefined ? { folderId, limit } : { folderId, limit, cursor },
            );
            seen.push(...page.items.map((item) => item.tweet.tweetId));
            if (page.nextCursor === null) break;
            cursor = page.nextCursor;
            guard += 1;
            if (guard > 500) {
              problems.push(`seed${seed} paging did not terminate (${folderId}, limit ${limit})`);
              break;
            }
          }
          const expected = model.get(folderId) ?? new Set<string>();
          if (new Set(seen).size !== seen.length) {
            problems.push(`seed${seed} duplicate row (${folderId}, limit ${limit})`);
          }
          if (seen.length !== expected.size) {
            problems.push(
              `seed${seed} paging returned ${seen.length}, expected ${expected.size} (${folderId}, limit ${limit})`,
            );
          }
        }
      }

      clockSpy.mockRestore();
      db.close();
    }

    expect(problems.slice(0, 8)).toEqual([]);
    expect(problems).toHaveLength(0);
  }, 120_000);
});
