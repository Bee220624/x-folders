import { MAX_FOLDER_DEPTH, POSITION_STEP } from '@/core/constants';
import type { Folder, FolderId } from '@/core/domain/folder';
import { DomainError } from '@/core/errors/DomainError';
import { newFolderId } from '@/core/ids';
import { folderNameKey, normalizeFolderName } from '@/utils/text';
import type { XFoldersDatabase } from '../db/XFoldersDatabase';

/**
 * All methods here assume they are already inside a Dexie transaction whose
 * scope includes the tables they touch. They never await a non-Dexie promise —
 * doing so would let IndexedDB auto-commit the transaction mid-way.
 */
export class FolderRepository {
  constructor(private readonly db: XFoldersDatabase) {}

  async listAll(): Promise<Folder[]> {
    return this.db.folders.toArray();
  }

  async get(folderId: FolderId): Promise<Folder | undefined> {
    return this.db.folders.get(folderId);
  }

  async require(folderId: FolderId): Promise<Folder> {
    const folder = await this.get(folderId);
    if (folder === undefined) {
      throw new DomainError('FOLDER_NOT_FOUND', '文件夹不存在。', { folderId });
    }
    return folder;
  }

  /** Siblings of `parentId`, ordered the same way the tree renders them. */
  async siblings(parentId: FolderId | null): Promise<Folder[]> {
    const all = await this.listAll();
    return all
      .filter((folder) => folder.parentId === parentId)
      .sort(
        (a, b) =>
          a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );
  }

  /**
   * Sibling name uniqueness is case-insensitive after NFC normalisation. There
   * is no index for it — the check runs over the in-transaction folder list, so
   * two tabs racing to create the same name cannot both win.
   */
  async assertNameAvailable(
    parentId: FolderId | null,
    name: string,
    exceptId?: FolderId,
  ): Promise<void> {
    const key = folderNameKey(name);
    const siblings = await this.siblings(parentId);
    const clash = siblings.some(
      (folder) => folder.id !== exceptId && folderNameKey(folder.name) === key,
    );
    if (clash) {
      throw new DomainError('DUPLICATE_FOLDER_NAME', '同级下已存在同名文件夹。');
    }
  }

  async create(rawName: string, parentId: FolderId | null, now: number): Promise<Folder> {
    const name = normalizeFolderName(rawName);

    if (parentId !== null) {
      const parent = await this.require(parentId);
      // Depth is capped at two levels: a parent that already has a parent would
      // make this folder the third.
      if (parent.parentId !== null) {
        throw new DomainError('MAX_DEPTH', `最多支持 ${MAX_FOLDER_DEPTH} 层文件夹。`);
      }
    }

    await this.assertNameAvailable(parentId, name);

    const siblings = await this.siblings(parentId);
    const maxPosition = siblings.reduce((max, folder) => Math.max(max, folder.position), 0);

    const folder: Folder = {
      id: newFolderId(),
      name,
      parentId,
      position: maxPosition + POSITION_STEP,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.folders.add(folder);
    return folder;
  }

  async rename(folderId: FolderId, rawName: string, now: number): Promise<Folder> {
    const folder = await this.require(folderId);
    const name = normalizeFolderName(rawName);
    if (name === folder.name) return folder;
    await this.assertNameAvailable(folder.parentId, name, folder.id);
    const updated: Folder = { ...folder, name, updatedAt: now };
    await this.db.folders.put(updated);
    return updated;
  }

  async setCollapsed(folderId: FolderId, collapsed: boolean, now: number): Promise<Folder> {
    const folder = await this.require(folderId);
    if (folder.collapsed === collapsed) return folder;
    const updated: Folder = { ...folder, collapsed, updatedAt: now };
    await this.db.folders.put(updated);
    return updated;
  }

  /**
   * Swaps a folder with its previous/next sibling. Positions are rewritten to a
   * clean 1000, 2000, 3000 ladder first, so repeated moves cannot drift into
   * collisions or negative values.
   */
  async move(folderId: FolderId, direction: -1 | 1, now: number): Promise<Folder[]> {
    const folder = await this.require(folderId);
    const siblings = await this.siblings(folder.parentId);
    const index = siblings.findIndex((candidate) => candidate.id === folderId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return [];

    const reordered = siblings.slice();
    const moved = reordered[index];
    const displaced = reordered[target];
    if (moved === undefined || displaced === undefined) return [];
    reordered[index] = displaced;
    reordered[target] = moved;

    const updates = reordered.map((sibling, position): Folder => ({
      ...sibling,
      position: (position + 1) * POSITION_STEP,
      updatedAt: now,
    }));
    await this.db.folders.bulkPut(updates);
    return updates;
  }

  /**
   * The folder plus every descendant at any depth, self first (review defect 4).
   * A corrupted parent cycle cannot loop: each id is taken once.
   */
  async subtreeIds(folderId: FolderId): Promise<FolderId[]> {
    const all = await this.listAll();
    const childrenOf = new Map<FolderId, FolderId[]>();
    for (const folder of all) {
      if (folder.parentId === null) continue;
      const siblings = childrenOf.get(folder.parentId);
      if (siblings === undefined) childrenOf.set(folder.parentId, [folder.id]);
      else siblings.push(folder.id);
    }

    const ids: FolderId[] = [];
    const seen = new Set<FolderId>();
    const queue: FolderId[] = [folderId];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      queue.push(...(childrenOf.get(id) ?? []));
    }
    return ids;
  }

  async deleteMany(folderIds: readonly FolderId[]): Promise<void> {
    await this.db.folders.bulkDelete([...folderIds]);
  }
}
