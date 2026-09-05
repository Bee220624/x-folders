import { RECENT_FOLDERS_MAX } from '@/core/constants';
import type { FolderId } from '@/core/domain/folder';
import type { XFoldersDatabase } from '../db/XFoldersDatabase';

export class MetaRepository {
  constructor(private readonly db: XFoldersDatabase) {}

  async recentFolderIds(): Promise<FolderId[]> {
    const row = await this.db.meta.get('recentFolders');
    return row?.folderIds ?? [];
  }

  /** Moves `folderId` to the front, de-duplicates, and caps the list. */
  async touchRecent(folderId: FolderId): Promise<FolderId[]> {
    const current = await this.recentFolderIds();
    const next = [folderId, ...current.filter((id) => id !== folderId)].slice(
      0,
      RECENT_FOLDERS_MAX,
    );
    await this.db.meta.put({ key: 'recentFolders', folderIds: next });
    return next;
  }

  async removeRecent(folderIds: readonly FolderId[]): Promise<FolderId[]> {
    const current = await this.recentFolderIds();
    const removed = new Set(folderIds);
    const next = current.filter((id) => !removed.has(id));
    if (next.length !== current.length) {
      await this.db.meta.put({ key: 'recentFolders', folderIds: next });
    }
    return next;
  }
}
