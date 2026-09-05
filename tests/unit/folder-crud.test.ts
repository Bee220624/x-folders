import { beforeEach, describe, expect, it } from 'vitest';
import { FolderService } from '@/background/services/FolderService';
import type { XFoldersDatabase } from '@/background/db/XFoldersDatabase';
import { DomainError } from '@/core/errors/DomainError';
import { buildFolderTree, flattenTree } from '@/core/domain/folder';
import { freshDatabase } from '../helpers/db';

const CH = String.fromCharCode;

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    return `UNEXPECTED:${String(error)}`;
  }
  return 'NO_THROW';
}

describe('folder CRUD', () => {
  let db: XFoldersDatabase;
  let service: FolderService;

  beforeEach(async () => {
    db = await freshDatabase();
    service = new FolderService(db);
  });

  it('creates a root folder', async () => {
    const folder = await service.create('AI', null);
    expect(folder.parentId).toBeNull();
    expect(folder.name).toBe('AI');
    expect(folder.collapsed).toBe(false);
    const snapshot = await service.snapshot();
    expect(snapshot.folders).toHaveLength(1);
    expect(snapshot.folders[0]?.tweetCount).toBe(0);
  });

  it('creates a legal child folder', async () => {
    const root = await service.create('AI', null);
    const child = await service.create('Agent', root.id);
    expect(child.parentId).toBe(root.id);
    const tree = buildFolderTree((await service.snapshot()).folders);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.name)).toEqual(['Agent']);
    expect(tree[0]?.children[0]?.depth).toBe(1);
  });

  it('rejects a third level with MAX_DEPTH', async () => {
    const root = await service.create('AI', null);
    const child = await service.create('Agent', root.id);
    expect(await codeOf(() => service.create('Deep', child.id))).toBe('MAX_DEPTH');
  });

  it('rejects a duplicate sibling name case-insensitively', async () => {
    await service.create('AI', null);
    expect(await codeOf(() => service.create('  ai  ', null))).toBe('DUPLICATE_FOLDER_NAME');
  });

  it('allows the same name under different parents', async () => {
    const a = await service.create('AI', null);
    const b = await service.create('Programming', null);
    await service.create('Notes', a.id);
    const second = await service.create('Notes', b.id);
    expect(second.name).toBe('Notes');
  });

  it('normalises Unicode before comparing sibling names', async () => {
    // Precomposed U+00C5 vs decomposed A + U+030A: distinct strings, same NFC
    // form, so the second create must be rejected as a duplicate.
    const precomposed = CH(0x00c5) + 'ngstrom';
    const decomposed = 'A' + CH(0x030a) + 'ngstrom';
    expect(precomposed).not.toBe(decomposed);
    await service.create(precomposed, null);
    expect(await codeOf(() => service.create(decomposed, null))).toBe('DUPLICATE_FOLDER_NAME');
  });

  it('rejects blank, whitespace-only and over-long names', async () => {
    expect(await codeOf(() => service.create('', null))).toBe('INVALID_FOLDER_NAME');
    expect(await codeOf(() => service.create('   ', null))).toBe('INVALID_FOLDER_NAME');
    expect(await codeOf(() => service.create('x'.repeat(65), null))).toBe('INVALID_FOLDER_NAME');
  });

  it('rejects names containing control characters', async () => {
    expect(await codeOf(() => service.create('a' + CH(1) + 'b', null))).toBe(
      'INVALID_FOLDER_NAME',
    );
    expect(await codeOf(() => service.create('line' + CH(0x2028) + 'break', null))).toBe(
      'INVALID_FOLDER_NAME',
    );
  });

  it('trims on create and rename', async () => {
    const folder = await service.create('  AI  ', null);
    expect(folder.name).toBe('AI');
    const renamed = await service.rename(folder.id, '  Machine Learning  ');
    expect(renamed.name).toBe('Machine Learning');
  });

  it('rejects renaming onto an existing sibling name but allows a no-op rename', async () => {
    const a = await service.create('AI', null);
    await service.create('Investing', null);
    expect(await codeOf(() => service.rename(a.id, 'investing'))).toBe('DUPLICATE_FOLDER_NAME');
    const same = await service.rename(a.id, 'AI');
    expect(same.name).toBe('AI');
  });

  it('persists the collapsed flag', async () => {
    const folder = await service.create('AI', null);
    await service.setCollapsed(folder.id, true);
    const snapshot = await service.snapshot();
    expect(snapshot.folders[0]?.collapsed).toBe(true);
  });

  it('moves siblings up and down and normalises positions', async () => {
    const a = await service.create('A', null);
    await service.create('B', null);
    const c = await service.create('C', null);

    const names = async (): Promise<string[]> =>
      flattenTree(buildFolderTree((await service.snapshot()).folders)).map((f) => f.name);

    expect(await names()).toEqual(['A', 'B', 'C']);
    await service.move(c.id, -1);
    expect(await names()).toEqual(['A', 'C', 'B']);
    await service.move(a.id, 1);
    expect(await names()).toEqual(['C', 'A', 'B']);

    const positions = (await service.snapshot()).folders
      .map((f) => f.position)
      .sort((x, y) => x - y);
    expect(positions).toEqual([1000, 2000, 3000]);
  });

  it('is a no-op at the ends of a sibling list', async () => {
    const a = await service.create('A', null);
    const b = await service.create('B', null);
    await service.move(a.id, -1);
    await service.move(b.id, 1);
    const order = flattenTree(buildFolderTree((await service.snapshot()).folders)).map(
      (f) => f.name,
    );
    expect(order).toEqual(['A', 'B']);
  });

  it('moves only within a parent, never across parents', async () => {
    const root = await service.create('Root', null);
    await service.create('Other', null);
    const c1 = await service.create('C1', root.id);
    const c2 = await service.create('C2', root.id);
    await service.move(c1.id, 1);
    const snapshot = await service.snapshot();
    for (const child of [c1, c2]) {
      expect(snapshot.folders.find((f) => f.id === child.id)?.parentId).toBe(root.id);
    }
  });

  it('reports FOLDER_NOT_FOUND for unknown ids', async () => {
    expect(await codeOf(() => service.rename('nope', 'x'))).toBe('FOLDER_NOT_FOUND');
    expect(await codeOf(() => service.delete('nope'))).toBe('FOLDER_NOT_FOUND');
    expect(await codeOf(() => service.create('x', 'nope'))).toBe('FOLDER_NOT_FOUND');
  });

  it('never produces a cycle: a dangling parentId renders as a root', async () => {
    const root = await service.create('Root', null);
    await service.create('Child', root.id);
    await db.folders.update(root.id, { parentId: 'ghost' });
    const tree = buildFolderTree((await service.snapshot()).folders);
    expect(flattenTree(tree)).toHaveLength(2);
  });
});
