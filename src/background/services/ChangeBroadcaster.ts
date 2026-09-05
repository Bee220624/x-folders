import { CHANGE_CHANNEL_KEY } from '@/core/constants';
import type { FolderId } from '@/core/domain/folder';
import type { TweetId } from '@/core/domain/tweet';
import type { DatabaseChangedEvent } from '@/messaging/protocol';
import { createLogger } from '@/utils/logger';

const log = createLogger('broadcast');

export interface ChangeSet {
  foldersChanged?: boolean;
  affectedFolderIds?: FolderId[];
  affectedTweetIds?: TweetId[];
}

/**
 * Cross-tab change fan-out via `chrome.storage.local` + `storage.onChanged`.
 *
 * Chosen over `tabs.sendMessage` deliberately. Enumerating X tabs needs
 * `tabs.query({url})`, whose URL filter is ignored without either the `tabs`
 * permission or host permissions — and `content_scripts.matches` grants
 * neither. `storage.onChanged` fires in every content script with only the
 * `storage` permission, needs no tab enumeration, produces no
 * "receiving end does not exist" rejections, and survives worker termination.
 *
 * It is also not a long-lived port: ports would disconnect whenever the worker
 * is torn down, and reconnecting content scripts would wake it again in a loop.
 */
let counter = 0;

function nextRevision(): number {
  // Unique per write even within one millisecond, so storage.onChanged always
  // observes a value change and never coalesces two writes into silence.
  counter = (counter + 1) % 1000;
  return Date.now() * 1000 + counter;
}

export async function broadcast(change: ChangeSet): Promise<void> {
  const event: DatabaseChangedEvent = {
    type: 'xf:database-changed',
    revision: nextRevision(),
    foldersChanged: change.foldersChanged ?? false,
    affectedFolderIds: change.affectedFolderIds ?? [],
    affectedTweetIds: change.affectedTweetIds ?? [],
  };
  try {
    await chrome.storage.local.set({ [CHANGE_CHANNEL_KEY]: event });
  } catch (error) {
    // A failed broadcast must never fail the write that already committed.
    log.warn('broadcast failed', error);
  }
}
