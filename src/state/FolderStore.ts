import { CHANGE_CHANNEL_KEY } from '@/core/constants';
import {
  buildFolderTree,
  type FolderId,
  type FolderTreeNode,
  type FolderWithCount,
} from '@/core/domain/folder';
import { isDatabaseChangedEvent } from '@/messaging/protocol';
import { rpc } from '@/messaging/RpcClient';
import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';

const log = createLogger('folder-store');

/** Coalesces bursts of writes (e.g. a cascade delete) into one refresh. */
const REFRESH_DEBOUNCE_MS = 80;

export interface FolderStoreState {
  folders: FolderWithCount[];
  tree: FolderTreeNode[];
  recentFolderIds: FolderId[];
  activeFolderId: FolderId | null;
  loading: boolean;
  error: string | null;
  /** Bumped on every applied snapshot; lets views drop stale async results. */
  revision: number;
}

export type FolderStoreListener = (state: FolderStoreState) => void;

const EMPTY_STATE: FolderStoreState = {
  folders: [],
  tree: [],
  recentFolderIds: [],
  activeFolderId: null,
  loading: true,
  error: null,
  revision: 0,
};

/**
 * The single shared folder snapshot for the sidebar, the save popover and the
 * folder view. It talks to the background over RPC and never touches Dexie or
 * the DOM itself.
 */
export class FolderStore {
  #state: FolderStoreState = EMPTY_STATE;
  readonly #listeners = new Set<FolderStoreListener>();
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #inFlight = 0;

  get state(): FolderStoreState {
    return this.#state;
  }

  subscribe(listener: FolderStoreListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Subscribes to the cross-tab change channel. `storage.onChanged` fires in
   * every content script of every X tab, so a folder created in one tab lands
   * here without any tab enumeration or extra permission.
   */
  attach(registry: CleanupRegistry): void {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== 'local') return;
      const change = changes[CHANGE_CHANNEL_KEY];
      if (change === undefined || !isDatabaseChangedEvent(change.newValue)) return;
      this.scheduleRefresh();
    };
    chrome.storage.onChanged.addListener(listener);
    registry.add(() => chrome.storage.onChanged.removeListener(listener));
    registry.add(() => {
      if (this.#refreshTimer !== null) clearTimeout(this.#refreshTimer);
      this.#listeners.clear();
    });
  }

  scheduleRefresh(): void {
    if (this.#refreshTimer !== null) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  async refresh(): Promise<void> {
    const ticket = ++this.#inFlight;
    const result = await rpc('folders.list', undefined);
    // A slower earlier request must never overwrite a newer snapshot.
    if (ticket !== this.#inFlight) return;

    if (!result.ok) {
      log.warn('refresh failed', result.error.code);
      this.#set({ loading: false, error: result.error.message });
      return;
    }
    const folders = result.data.folders;
    const activeStillExists =
      this.#state.activeFolderId !== null &&
      folders.some((folder) => folder.id === this.#state.activeFolderId);

    this.#set({
      folders,
      tree: buildFolderTree(folders),
      recentFolderIds: result.data.recentFolderIds,
      // A folder deleted in another tab must not leave a dangling active view.
      activeFolderId: activeStillExists ? this.#state.activeFolderId : null,
      loading: false,
      error: null,
      revision: this.#state.revision + 1,
    });
  }

  setActiveFolder(folderId: FolderId | null): void {
    if (this.#state.activeFolderId === folderId) return;
    this.#set({ activeFolderId: folderId });
  }

  findFolder(folderId: FolderId): FolderWithCount | undefined {
    return this.#state.folders.find((folder) => folder.id === folderId);
  }

  #set(patch: Partial<FolderStoreState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}
