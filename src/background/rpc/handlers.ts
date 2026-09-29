import type { RpcHandlers } from './RpcServer';
import { getDatabase } from '../db/XFoldersDatabase';
import { FolderService } from '../services/FolderService';
import { TweetSaveService } from '../services/TweetSaveService';
import type {
  CreateFolderPayload,
  FolderIdPayload,
  ListFolderTweetsPayload,
  RefreshTweetsPayload,
  RemoveTweetPayload,
  RenameFolderPayload,
  SaveTweetPayload,
  SetCollapsedPayload,
  TweetIdPayload,
  TweetIdsPayload,
} from '@/messaging/protocol';

/**
 * Services are constructed per call from the lazily opened database. Nothing is
 * cached in worker memory beyond the Dexie handle itself, so a terminated and
 * re-woken worker behaves identically to a cold start.
 */
export function createHandlers(): RpcHandlers {
  const folderService = (): FolderService => new FolderService(getDatabase());
  const tweetService = (): TweetSaveService => new TweetSaveService(getDatabase());

  return {
    // Read from the built manifest, which WXT fills in from package.json.
    'health.ping': async () => ({ ok: true as const, version: chrome.runtime.getManifest().version }),

    'folders.list': async () => folderService().snapshot(),
    'folders.create': async (payload) => {
      const { name, parentId } = payload as CreateFolderPayload;
      return folderService().create(name, parentId);
    },
    'folders.rename': async (payload) => {
      const { folderId, name } = payload as RenameFolderPayload;
      return folderService().rename(folderId, name);
    },
    'folders.setCollapsed': async (payload) => {
      const { folderId, collapsed } = payload as SetCollapsedPayload;
      return folderService().setCollapsed(folderId, collapsed);
    },
    'folders.moveUp': async (payload) =>
      folderService().move((payload as FolderIdPayload).folderId, -1),
    'folders.moveDown': async (payload) =>
      folderService().move((payload as FolderIdPayload).folderId, 1),
    'folders.deletePreview': async (payload) =>
      folderService().deletePreview((payload as FolderIdPayload).folderId),
    'folders.delete': async (payload) =>
      folderService().delete((payload as FolderIdPayload).folderId),

    'memberships.getForTweet': async (payload) =>
      tweetService().folderIdsForTweet((payload as TweetIdPayload).tweetId),
    'memberships.getCountsForTweets': async (payload) =>
      tweetService().countsForTweets((payload as TweetIdsPayload).tweetIds),
    'memberships.saveTweet': async (payload) => {
      const { folderId, tweet } = payload as SaveTweetPayload;
      return tweetService().save(folderId, tweet);
    },
    'memberships.removeTweet': async (payload) => {
      const { folderId, tweetId } = payload as RemoveTweetPayload;
      return tweetService().remove(folderId, tweetId);
    },
    'memberships.listFolderTweets': async (payload) =>
      tweetService().listFolderTweets(payload as ListFolderTweetsPayload),
    'tweets.refresh': async (payload) =>
      tweetService().refresh((payload as RefreshTweetsPayload).tweets),

    'meta.getRecentFolders': async () => tweetService().recentFolderIds(),
  };
}
