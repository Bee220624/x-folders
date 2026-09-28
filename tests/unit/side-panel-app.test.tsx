import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderWithCount } from '@/core/domain/folder';
import { FolderStore } from '@/state/FolderStore';

const { rpcMock, openPostMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
  openPostMock: vi.fn<(url: string, options: { newTab: boolean }) => Promise<void>>(),
}));

vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));
vi.mock('@/sidepanel/openPost', () => ({ openPost: openPostMock }));

import { SidePanelApp } from '@/sidepanel/SidePanelApp';

options.requestAnimationFrame = (callback: () => void): void => callback();

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const FOLDER: FolderWithCount = {
  id: 'f1',
  name: 'AI',
  parentId: null,
  position: 1000,
  collapsed: false,
  createdAt: 1,
  updatedAt: 1,
  tweetCount: 1,
};
const POST = 'https://x.com/alice/status/1000000000000000001';

describe('SidePanelApp', () => {
  let container: HTMLElement;

  beforeEach(() => {
    openPostMock.mockReset().mockResolvedValue(undefined);
    rpcMock.mockReset().mockImplementation(async (method) => {
      if (method === 'folders.list') {
        return { ok: true, data: { folders: [FOLDER], recentFolderIds: [] } };
      }
      if (method === 'memberships.listFolderTweets') {
        return {
          ok: true,
          data: {
            items: [
              {
                savedAt: 1,
                tweet: {
                  tweetId: '1000000000000000001',
                  canonicalUrl: POST,
                  authorName: 'Alice',
                  username: 'alice',
                  text: '一条收藏',
                  capturedAt: 1,
                  updatedAt: 1,
                },
              },
            ],
            nextCursor: null,
          },
        };
      }
      return { ok: true, data: null };
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('lists a folder’s posts and routes a click to openPost instead of navigating the panel', async () => {
    const before = location.href;
    render(<SidePanelApp store={new FolderStore()} />, container);
    await flush();

    const folderButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'AI',
    );
    expect(folderButton).toBeDefined();
    folderButton?.click();
    await flush();

    const link = container.querySelector<HTMLAnchorElement>(`a[href="${POST}"]`);
    expect(link).not.toBeNull();
    link?.click();

    expect(openPostMock).toHaveBeenCalledWith(POST, { newTab: false });
    expect(location.href).toBe(before);
  });
});
