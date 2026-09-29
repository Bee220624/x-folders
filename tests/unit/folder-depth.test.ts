import { describe, expect, it } from 'vitest';
import { FolderRepository } from '@/background/repositories/FolderRepository';
import { buildFolderTree, flattenTree, type Folder, type FolderWithCount } from '@/core/domain/folder';
import { freshDatabase } from '../helpers/db';

function folder(id: string, parentId: string | null): Folder {
  return { id, name: id, parentId, position: 1000, collapsed: false, createdAt: 1, updatedAt: 1 };
}

function withCount(row: Folder): FolderWithCount {
  return { ...row, tweetCount: 0 };
}

describe('folder depth is not hard-wired to two levels (review defect 4)', () => {
  it('computes each depth by walking down from the roots', () => {
    const tree = buildFolderTree([folder('a', null), folder('b', 'a'), folder('c', 'b')].map(withCount));
    expect(flattenTree(tree).map((node) => [node.id, node.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('keeps every folder of a corrupted parent cycle', () => {
    const tree = buildFolderTree([folder('r', null), folder('x', 'y'), folder('y', 'x')].map(withCount));
    expect(flattenTree(tree).map((node) => node.id).sort()).toEqual(['r', 'x', 'y']);
  });

  it('collects descendants at any depth and survives a cycle', async () => {
    const db = await freshDatabase();
    await db.folders.bulkAdd([
      folder('a', null),
      folder('b', 'a'),
      folder('c', 'b'),
      folder('z', null),
      folder('p', 'q'),
      folder('q', 'p'),
    ]);
    const repository = new FolderRepository(db);
    expect((await repository.subtreeIds('a')).sort()).toEqual(['a', 'b', 'c']);
    expect((await repository.subtreeIds('p')).sort()).toEqual(['p', 'q']);
    db.close();
  });
});
