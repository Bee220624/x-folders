import { options } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderWithCount } from '@/core/domain/folder';
import type { SavedTweetView } from '@/core/domain/membership';
import { FolderViewMount } from '@/hosts/x/FolderViewMount';
import { locatePrimaryColumn } from '@/hosts/x/PrimaryColumnLocator';
import { ThemeAdapter } from '@/hosts/x/ThemeAdapter';
import { X_SELECTORS, XF_ATTR } from '@/hosts/x/selectors';
import type { ListFolderTweetsPayload, RemoveTweetPayload } from '@/messaging/protocol';
import { FolderStore } from '@/state/FolderStore';
import { shadowRootOf } from '@/ui/shared/ShadowHost';
import { CleanupRegistry } from '@/utils/cleanup';
import { loadFixture } from '../helpers/fixtures';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
}));

vi.mock('@/messaging/RpcClient', () => ({
  rpc: rpcMock,
  rpcOrNull: vi.fn(),
}));

/**
 * Preact defers effects to after paint. Running them straight away makes the
 * whole view deterministic: one macrotask turn per await is then enough.
 */
options.requestAnimationFrame = (callback: () => void): void => callback();

const BASE_TIME = 1_700_000_000_000;
const COLUMN = { left: 312, top: 53, width: 600, height: 2400 };
const FOLDER_ID = 'folder-1';
/** Its page hangs until the test releases it, to model a slow background. */
const SLOW_FOLDER_ID = 'folder-slow';
const SLOW_TEXT = '来自另一个文件夹的迟到结果';

let records: SavedTweetView[] = [];
let folders: FolderWithCount[] = [];
let listPayloads: ListFolderTweetsPayload[] = [];
let removals: RemoveTweetPayload[] = [];
let membershipChanges: Array<[string, number]> = [];
let registry: CleanupRegistry;
let store: FolderStore;
let mount: FolderViewMount;
let slowPage: Promise<void>;
let releaseSlowPage: () => void;

function folderFixture(tweetCount: number): FolderWithCount {
  return {
    id: FOLDER_ID,
    name: 'AI 收藏',
    parentId: null,
    position: 1000,
    collapsed: false,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    tweetCount,
  };
}

/** Newest first, one second apart, matching `savedAt`-descending order. */
function savedView(
  index: number,
  overrides: { url?: string; text?: string; savedAt?: number } = {},
): SavedTweetView {
  const tweetId = String(1_000_000_000_000_000_000n + BigInt(index));
  const username = `user${index}`;
  const text = overrides.text ?? `第 ${index} 条收藏`;
  return {
    savedAt: overrides.savedAt ?? BASE_TIME - index * 1000,
    tweet: {
      tweetId,
      canonicalUrl: overrides.url ?? `https://x.com/${username}/status/${tweetId}`,
      authorName: `作者${index}`,
      username,
      avatarUrl: null,
      verified: false,
      postedAt: null,
      text,
      segments: [{ kind: 'text', text }],
      media: [],
      quote: null,
      card: null,
      truncated: false,
      capturedAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
  };
}

function seed(count: number): void {
  records = Array.from({ length: count }, (_unused, index) => savedView(index));
  folders = [folderFixture(count)];
}

/** Keyset paging over the fake store, exactly as the background does it. */
function page(payload: ListFolderTweetsPayload): unknown {
  const cursor = payload.cursor;
  const start =
    cursor === undefined
      ? 0
      : records.findIndex((record) => record.tweet.tweetId === cursor.tweetId) + 1;
  const items = records.slice(start, start + payload.limit);
  const last = items.at(-1);
  const exhausted = last === undefined || start + items.length >= records.length;
  return {
    ok: true,
    data: {
      items,
      nextCursor:
        exhausted || last === undefined
          ? null
          : { savedAt: last.savedAt, tweetId: last.tweet.tweetId },
    },
  };
}

function stubRect(element: HTMLElement, rect: typeof COLUMN): void {
  element.getBoundingClientRect = (): DOMRect => ({
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  });
}

function host(): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[${XF_ATTR.overlayHost}]`);
  if (element === null) throw new Error('overlay host missing');
  return element;
}

// The overlay's shadow root is closed, so it is reached through the first-party
// lookup rather than `host().shadowRoot`, which is null for everyone.
function shadow(): ShadowRoot {
  const root = shadowRootOf(host());
  if (root === null) throw new Error('overlay shadow root missing');
  return root;
}

function rows(): HTMLElement[] {
  return Array.from(shadow().querySelectorAll<HTMLElement>('.xf-fv-row'));
}

function textOf(selector: string): string {
  return shadow().querySelector(selector)?.textContent ?? '';
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function open(): Promise<void> {
  mount.open(FOLDER_ID);
  await settle();
}

async function scrollToEnd(): Promise<void> {
  // jsdom reports every scroll metric as 0, which reads as "at the bottom" —
  // the condition the prefetch is written against.
  shadow().querySelector('.xf-fv-list')?.dispatchEvent(new Event('scroll'));
  await settle();
}

describe('folder view', () => {
  beforeEach(async () => {
    loadFixture('x-home');
    seed(0);
    listPayloads = [];
    removals = [];
    membershipChanges = [];
    releaseSlowPage = () => {};
    slowPage = new Promise<void>((resolve) => {
      releaseSlowPage = resolve;
    });

    rpcMock.mockReset();
    rpcMock.mockImplementation(async (method, payload) => {
      switch (method) {
        case 'folders.list':
          return { ok: true, data: { folders, recentFolderIds: [] } };
        case 'memberships.listFolderTweets': {
          const request = payload as ListFolderTweetsPayload;
          listPayloads.push(request);
          if (request.folderId === SLOW_FOLDER_ID) {
            await slowPage;
            return {
              ok: true,
              data: { items: [savedView(900, { text: SLOW_TEXT })], nextCursor: null },
            };
          }
          return page(request);
        }
        case 'memberships.removeTweet': {
          const request = payload as RemoveTweetPayload;
          removals.push(request);
          records = records.filter((record) => record.tweet.tweetId !== request.tweetId);
          return { ok: true, data: { membershipCount: 0, tweetDeleted: true } };
        }
        default:
          return { ok: false, error: { code: 'UNKNOWN', message: 'unexpected call' } };
      }
    });

    registry = new CleanupRegistry();
    store = new FolderStore();
    store.attach(registry);
    mount = new FolderViewMount({
      store,
      theme: new ThemeAdapter(document),
      registry,
      onMembershipChanged: (tweetId, membershipCount) =>
        membershipChanges.push([tweetId, membershipCount]),
    });

    const column = document.querySelector<HTMLElement>(X_SELECTORS.primaryColumn);
    if (column === null) throw new Error('fixture has no primary column');
    stubRect(column, COLUMN);
  });

  afterEach(() => {
    mount.dispose();
    registry.dispose();
  });

  it('aligns the overlay to the primary column and leaves X mounted underneath', async () => {
    seed(3);
    await store.refresh();
    await open();

    const style = host().style;
    expect(style.position).toBe('fixed');
    expect(style.left).toBe('312px');
    expect(style.width).toBe('600px');
    // The column's own rect spans the whole timeline, so only its horizontal
    // extent is used; vertically the overlay covers the visible part.
    expect(style.top).toBe('53px');
    expect(style.height).toBe(`${window.innerHeight - 53}px`);

    // X's own DOM must still be there, underneath the overlay.
    expect(document.querySelectorAll(X_SELECTORS.tweetRoot).length).toBeGreaterThan(0);
    expect(document.querySelector(X_SELECTORS.primaryColumn)).not.toBeNull();
  });

  it('inserts the host before #layers so X keeps painting its own dialogs on top', async () => {
    seed(1);
    await store.refresh();
    await open();

    const layers = document.querySelector(X_SELECTORS.layers);
    expect(layers).not.toBeNull();
    expect(layers?.previousElementSibling).toBe(host());
    // Equal, modest z-index plus earlier tree order: #layers still wins.
    expect(host().style.zIndex).toBe('1');
  });

  it('falls back to the main landmark when the primaryColumn testid is gone', () => {
    const column = document.querySelector<HTMLElement>(X_SELECTORS.primaryColumn);
    column?.removeAttribute('data-testid');

    const main = document.querySelector('main');
    const anchor = locatePrimaryColumn();
    expect(anchor).not.toBeNull();
    expect(anchor?.column).toBe(main?.firstElementChild);
  });

  it('renders one page and asks for the next only when the reader reaches the end', async () => {
    seed(120);
    await store.refresh();
    await open();

    expect(listPayloads).toHaveLength(1);
    expect(listPayloads[0]?.limit).toBe(50);
    expect(listPayloads[0]?.cursor).toBeUndefined();
    expect(rows()).toHaveLength(50);

    await scrollToEnd();
    expect(listPayloads).toHaveLength(2);
    expect(listPayloads[1]?.cursor?.tweetId).toBe(records[49]?.tweet.tweetId);
    expect(rows()).toHaveLength(100);

    await scrollToEnd();
    expect(listPayloads).toHaveLength(3);
    expect(rows()).toHaveLength(120);

    // The third page came back with a null cursor: the list is done asking.
    await scrollToEnd();
    await scrollToEnd();
    expect(listPayloads).toHaveLength(3);
    expect(textOf('.xf-fv-footer')).toContain('没有更多了');
  });

  it('never renders a whole folder at once', async () => {
    seed(1000);
    await store.refresh();
    await open();

    expect(rows()).toHaveLength(50);
    expect(listPayloads).toHaveLength(1);
    expect(shadow().textContent).not.toContain('第 60 条收藏');
  });

  it('discards a page that resolves after the folder switched', async () => {
    seed(2);
    folders = [folderFixture(2), { ...folderFixture(1), id: SLOW_FOLDER_ID, name: '慢文件夹' }];
    await store.refresh();

    mount.open(SLOW_FOLDER_ID);
    await settle();
    expect(listPayloads[0]?.folderId).toBe(SLOW_FOLDER_ID);

    mount.open(FOLDER_ID);
    await settle();
    expect(rows()).toHaveLength(2);

    releaseSlowPage();
    await settle();
    // The late page belongs to a folder nobody is looking at any more.
    expect(shadow().textContent).not.toContain(SLOW_TEXT);
    expect(rows()).toHaveLength(2);
    expect(mount.activeFolderId()).toBe(FOLDER_ID);
  });

  it('drops a page that arrives after the view was closed', async () => {
    seed(2);
    folders = [folderFixture(2), { ...folderFixture(1), id: SLOW_FOLDER_ID, name: '慢文件夹' }];
    await store.refresh();

    mount.open(SLOW_FOLDER_ID);
    await settle();
    mount.close();
    releaseSlowPage();
    await settle();

    expect(mount.isOpen()).toBe(false);
    expect(mount.activeFolderId()).toBeNull();
    expect(document.querySelector(`[${XF_ATTR.overlayHost}]`)).toBeNull();
    // Reopening starts from a clean list rather than the resolved stale page.
    await open();
    expect(shadow().textContent).not.toContain(SLOW_TEXT);
    expect(rows()).toHaveLength(2);
  });

  it('removes a row and updates the count without refetching the list', async () => {
    seed(3);
    await store.refresh();
    await open();
    expect(rows()).toHaveLength(3);
    expect(textOf('.xf-fv-count')).toBe('3 条收藏');

    const target = records[1];
    const more = rows()[1]?.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]');
    expect(more).not.toBeNull();
    more?.click();
    await settle();
    const removeItem = Array.from(shadow().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (item) => item.textContent === '从此文件夹移除',
    );
    expect(removeItem).toBeDefined();
    removeItem?.click();
    await settle();

    expect(removals).toEqual([{ folderId: FOLDER_ID, tweetId: target?.tweet.tweetId }]);
    expect(rows()).toHaveLength(2);
    expect(rows().map((row) => row.getAttribute(XF_ATTR.tweetId))).toEqual([
      records[0]?.tweet.tweetId,
      records[1]?.tweet.tweetId,
    ]);
    expect(textOf('.xf-fv-count')).toBe('2 条收藏');
    expect(membershipChanges).toEqual([[target?.tweet.tweetId, 0]]);
    // The whole point: no second listFolderTweets call.
    expect(listPayloads).toHaveLength(1);
  });

  it('links each row to its post and never links an unsafe one', async () => {
    records = [savedView(0), savedView(1, { url: 'https://evil.example.com/user1/status/1' })];
    folders = [folderFixture(records.length)];
    await store.refresh();
    await open();

    const safe = rows()[0];
    const unsafe = rows()[1];
    expect(safe?.querySelector('a.xf-tc-time')?.getAttribute('href')).toBe(records[0]?.tweet.canonicalUrl);
    expect(unsafe?.querySelector('a.xf-tc-time')).toBeNull();
    // The row still shows what was saved; it just is not a link.
    expect(unsafe?.textContent).toContain('第 1 条收藏');
  });

  it('shows the author, handle and the day it was saved', async () => {
    records = [savedView(0, { savedAt: new Date(2026, 8, 26, 10).getTime() })];
    folders = [folderFixture(1)];
    await store.refresh();
    await open();

    expect(textOf('.xf-tc-name')).toBe('作者0');
    expect(textOf('.xf-tc-handle')).toBe('@user0');
    expect(textOf('.xf-tc-saved')).toMatch(/^保存于 (2026年)?9月26日$/);
  });

  it('separates the empty, loading and error states', async () => {
    seed(0);
    await store.refresh();
    await open();
    expect(shadow().textContent).toContain('这个文件夹还没有收藏的帖子。');

    rpcMock.mockImplementation(async (method) => {
      if (method === 'folders.list') return { ok: true, data: { folders, recentFolderIds: [] } };
      return { ok: false, error: { code: 'DATABASE_ERROR', message: 'boom' } };
    });
    mount.close();
    await open();
    expect(shadow().querySelector('.xf-fv-state')?.getAttribute('data-tone')).toBe('danger');
    expect(shadow().textContent).toContain('本地数据库操作失败');
  });

  it('closes the view when the folder disappears from the store', async () => {
    seed(2);
    await store.refresh();
    await open();
    expect(mount.isOpen()).toBe(true);

    // Deleted in another tab: the next snapshot simply no longer has it.
    folders = [];
    await store.refresh();
    mount.ensure();

    expect(mount.isOpen()).toBe(false);
    expect(mount.activeFolderId()).toBeNull();
    expect(document.querySelector(`[${XF_ATTR.overlayHost}]`)).toBeNull();
  });

  it('re-aligns and re-attaches on every ensure tick', async () => {
    seed(2);
    await store.refresh();
    await open();

    const column = document.querySelector<HTMLElement>(X_SELECTORS.primaryColumn);
    if (column === null) throw new Error('fixture has no primary column');
    stubRect(column, { left: 400, top: 0, width: 520, height: 900 });
    mount.ensure();
    expect(host().style.left).toBe('400px');
    expect(host().style.width).toBe('520px');

    // X replaced the container that held our host.
    host().remove();
    mount.ensure();
    expect(document.querySelectorAll(`[${XF_ATTR.overlayHost}]`)).toHaveLength(1);

    // A cloned subtree left a second host behind.
    host().after(host().cloneNode(true));
    expect(document.querySelectorAll(`[${XF_ATTR.overlayHost}]`)).toHaveLength(2);
    mount.ensure();
    expect(document.querySelectorAll(`[${XF_ATTR.overlayHost}]`)).toHaveLength(1);
    expect(rows()).toHaveLength(2);
  });
});
