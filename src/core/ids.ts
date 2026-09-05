import type { FolderId } from './domain/folder';

/**
 * Folder ids are random UUIDs. `crypto.randomUUID` exists in the service
 * worker, in content scripts and in jsdom (Node 20+), so no polyfill is needed.
 */
export function newFolderId(): FolderId {
  return crypto.randomUUID();
}
