import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECENT_FOLDERS_MAX } from '@/core/constants';
import type { Folder, FolderId } from '@/core/domain/folder';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import { messageFor, type ErrorCode } from '@/core/errors/DomainError';
import {
  isRpcRequest,
  type CreateFolderPayload,
  type RemoveTweetPayload,
  type SaveTweetPayload,
  type SetCollapsedPayload,
  type TweetIdPayload,
} from '@/messaging/protocol';
import { fail, ok, type RpcResult } from '@/messaging/result';
import { FolderStore } from '@/state/FolderStore';
import { SavePopoverController } from '@/hosts/x/SavePopoverController';
import { ThemeAdapter } from '@/hosts/x/ThemeAdapter';
import { TweetActionInjector } from '@/hosts/x/TweetActionInjector';
import { XF_ATTR } from '@/hosts/x/selectors';
import { shadowRootOf } from '@/ui/shared/ShadowHost';
import { toasts } from '@/ui/shared/toastStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { loadFixture } from '../helpers/fixtures';

const TWEET_ID: TweetId = '1000000000000000001';

const TWEET: TweetRecord = {
  tweetId: TWEET_ID,
  canonicalUrl: `https://x.com/alice/status/${TWEET_ID}`,
  authorName: 'Alice',
  username: 'alice',
  text: 'hello',
  capturedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const POPOVER = `[${XF_ATTR.popoverHost}]`;

/**
 * Stands in for the service worker. It keeps real state, so idempotence and
 * membership counts are observed rather than asserted against a script, and it
 * can hold a reply back to reproduce a response that lands after a close.
 */
class FakeBackground {
  readonly folders: Folder[] = [];
  readonly memberships = new Map<FolderId, Set<TweetId>>();
  recentFolderIds: FolderId[] = [];
  failNext: ErrorCode | null = null;
  holding = false;
  readonly held: Array<() => void> = [];
  #nextId = 1;

  install(): void {
    const send = (request: unknown, respond: (response: unknown) => void): void => {
      if (!isRpcRequest(request)) {
        respond(fail('INVALID_REQUEST', 'unrecognised'));
        return;
      }
      const { method, payload } = request;
      const deliver = (): void => respond(this.#handle(method, payload));
      if (this.holding) this.held.push(deliver);
      else queueMicrotask(deliver);
    };
    chrome.runtime.sendMessage = send as unknown as typeof chrome.runtime.sendMessage;
  }

  /** Delivers every held reply and stops holding. */
  release(): void {
    const queued = [...this.held];
    this.held.length = 0;
    this.holding = false;
    for (const deliver of queued) deliver();
  }

  addFolder(name: string, parentId: FolderId | null = null): Folder {
    const folder: Folder = {
      id: `f${this.#nextId++}`,
      name,
      parentId,
      position: this.folders.length * 1000,
      collapsed: false,
      createdAt: 1,
      updatedAt: 1,
    };
    this.folders.push(folder);
    return folder;
  }

  foldersHolding(tweetId: TweetId): FolderId[] {
    return this.folders
      .filter((folder) => this.memberships.get(folder.id)?.has(tweetId) === true)
      .map((folder) => folder.id);
  }

  #handle(method: string, payload: unknown): RpcResult<unknown> {
    if (this.failNext !== null) {
      const code = this.failNext;
      this.failNext = null;
      return fail(code, 'raw message that must never be shown');
    }
    switch (method) {
      case 'folders.list':
        return ok({
          folders: this.folders.map((folder) => ({
            ...folder,
            tweetCount: this.memberships.get(folder.id)?.size ?? 0,
          })),
          recentFolderIds: [...this.recentFolderIds],
        });
      case 'folders.create': {
        const { name, parentId } = payload as CreateFolderPayload;
        return ok(this.addFolder(name, parentId));
      }
      case 'folders.setCollapsed': {
        const { folderId, collapsed } = payload as SetCollapsedPayload;
        const folder = this.folders.find((candidate) => candidate.id === folderId);
        if (folder === undefined) return fail('FOLDER_NOT_FOUND', 'missing');
        folder.collapsed = collapsed;
        return ok(folder);
      }
      case 'memberships.getForTweet': {
        const { tweetId } = payload as TweetIdPayload;
        return ok(this.foldersHolding(tweetId));
      }
      case 'memberships.saveTweet': {
        const { folderId, tweet } = payload as SaveTweetPayload;
        const holders = this.memberships.get(folderId) ?? new Set<TweetId>();
        const alreadyExists = holders.has(tweet.tweetId);
        holders.add(tweet.tweetId);
        this.memberships.set(folderId, holders);
        this.recentFolderIds = [
          folderId,
          ...this.recentFolderIds.filter((id) => id !== folderId),
        ];
        return ok({
          alreadyExists,
          savedAt: 2,
          membershipCount: this.foldersHolding(tweet.tweetId).length,
        });
      }
      case 'memberships.removeTweet': {
        const { folderId, tweetId } = payload as RemoveTweetPayload;
        const holders = this.memberships.get(folderId);
        if (holders === undefined || !holders.delete(tweetId)) {
          return fail('MEMBERSHIP_NOT_FOUND', 'missing');
        }
        const membershipCount = this.foldersHolding(tweetId).length;
        return ok({ membershipCount, tweetDeleted: membershipCount === 0 });
      }
      default:
        return fail('INVALID_REQUEST', 'unhandled');
    }
  }
}

/** Preact flushes effects after a frame; RPC replies land on the microtask queue. */
async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function hosts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(POPOVER));
}

// Closed root: reached through the first-party lookup, not `host.shadowRoot`.
function panel(): ShadowRoot {
  const root = shadowRootOf(hosts()[0]);
  if (root === null) throw new Error('popover is not open');
  return root;
}

function rows(groupLabel?: string): HTMLElement[] {
  const scope =
    groupLabel === undefined
      ? panel()
      : (panel().querySelector<HTMLElement>(`[aria-label="${groupLabel}"]`) ??
        (() => {
          throw new Error(`no ${groupLabel} group`);
        })());
  return Array.from(scope.querySelectorAll<HTMLElement>('.xf-popover-row'));
}

function nameOf(row: HTMLElement): string {
  return row.querySelector('.xf-row-name')?.textContent ?? '';
}

function rowFor(name: string, groupLabel?: string): HTMLElement {
  const match = rows(groupLabel).find((row) => nameOf(row) === name);
  if (match === undefined) throw new Error(`no row named ${name}`);
  return match;
}

function click(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

function messages(): string[] {
  return toasts.toasts.map((toast) => toast.message);
}

describe('save popover', () => {
  let backend: FakeBackground;
  let registry: CleanupRegistry;
  let controller: SavePopoverController;
  let anchor: HTMLElement;
  let changes: Array<[TweetId, number]>;
  let resolved: TweetRecord | null;

  beforeEach(() => {
    backend = new FakeBackground();
    backend.install();
    backend.addFolder('学习');
    backend.addFolder('工作');
    toasts.reset();

    const { tweets } = loadFixture('x-home');
    const injector = new TweetActionInjector(() => {});
    const injected = injector.ensure(tweets[0]!, { tweetId: TWEET_ID, savedCount: 0 });
    if (injected === null) throw new Error('no action button to anchor to');
    anchor = injected.host;

    changes = [];
    resolved = TWEET;
    registry = new CleanupRegistry();
    controller = new SavePopoverController({
      store: new FolderStore(),
      theme: new ThemeAdapter(document),
      registry,
      resolveTweet: () => resolved,
      onMembershipChanged: (tweetId, membershipCount) => changes.push([tweetId, membershipCount]),
    });
  });

  afterEach(() => {
    controller.dispose();
    registry.dispose();
    toasts.reset();
  });

  it('keeps exactly one popover no matter how often open is called', async () => {
    controller.open(TWEET_ID, anchor);
    controller.open(TWEET_ID, anchor);
    controller.open(TWEET_ID, anchor);
    await settle();

    expect(hosts()).toHaveLength(1);
    expect(controller.isOpen()).toBe(true);
    expect(panel().querySelectorAll('.xf-popover')).toHaveLength(1);

    controller.close();
    expect(hosts()).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);
  });

  it('converges on one host when a stray one survived a previous context', async () => {
    const stray = document.createElement('div');
    stray.setAttribute(XF_ATTR.popoverHost, '');
    document.body.appendChild(stray);

    controller.open(TWEET_ID, anchor);
    await settle();
    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]).not.toBe(stray);
  });

  it('checks the folders the tweet already belongs to', async () => {
    backend.memberships.set('f1', new Set([TWEET_ID]));
    controller.open(TWEET_ID, anchor);
    await settle();

    const saved = rowFor('学习', '全部文件夹');
    const unsaved = rowFor('工作', '全部文件夹');
    expect(saved.dataset.checked).toBe('true');
    expect(saved.querySelector('.xf-popover-check svg')).not.toBeNull();
    expect(saved.querySelector('.xf-row-name')?.getAttribute('aria-checked')).toBe('true');
    expect(unsaved.dataset.checked).toBe('false');
    expect(unsaved.querySelector('.xf-popover-check')).toBeNull();
  });

  it('saves into an unchecked folder, then reports and closes', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    click(rowFor('工作', '全部文件夹').querySelector('.xf-row-name'));
    await settle();

    expect(backend.foldersHolding(TWEET_ID)).toEqual(['f2']);
    expect(changes).toEqual([[TWEET_ID, 1]]);
    expect(messages()).toEqual(['已保存到 工作']);
    expect(hosts()).toHaveLength(0);
  });

  it('removes the tweet from a checked folder', async () => {
    backend.memberships.set('f1', new Set([TWEET_ID]));
    controller.open(TWEET_ID, anchor);
    await settle();

    click(rowFor('学习', '全部文件夹').querySelector('.xf-row-name'));
    await settle();

    expect(backend.foldersHolding(TWEET_ID)).toEqual([]);
    expect(changes).toEqual([[TWEET_ID, 0]]);
    expect(messages()).toEqual(['已从 学习 移除']);
    expect(hosts()).toHaveLength(0);
  });

  it('is idempotent when the same tweet is saved to a folder twice', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();
    click(rowFor('学习', '全部文件夹').querySelector('.xf-row-name'));
    await settle();

    // Reopen against a snapshot that has gone stale — another tab could have
    // saved the same pair in between — and save the very same folder again.
    controller.open(TWEET_ID, anchor);
    await settle();
    click(rowFor('工作', '全部文件夹').querySelector('.xf-row-name'));
    await settle();
    backend.memberships.get('f1')?.add(TWEET_ID);

    controller.open(TWEET_ID, anchor);
    await settle();
    expect(rowFor('学习', '全部文件夹').dataset.checked).toBe('true');
    expect(backend.memberships.get('f1')).toEqual(new Set([TWEET_ID]));
    expect(backend.foldersHolding(TWEET_ID)).toEqual(['f1', 'f2']);
    expect(changes).toEqual([
      [TWEET_ID, 1],
      [TWEET_ID, 2],
    ]);
  });

  it('creates a root folder and saves the tweet into it', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    click(panel().querySelector('.xf-popover-new'));
    await settle();

    const input = panel().querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('no name editor');
    input.value = '灵感';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();

    const created = backend.folders.find((folder) => folder.name === '灵感');
    expect(created?.parentId).toBeNull();
    expect(backend.foldersHolding(TWEET_ID)).toEqual([created?.id]);
    expect(messages()).toEqual(['已保存到 灵感']);
    expect(hosts()).toHaveLength(0);
  });

  it('shows at most RECENT_FOLDERS_MAX recents, with the full path of a child', async () => {
    const child = backend.addFolder('论文', 'f1');
    const idea = backend.addFolder('灵感');
    const archive = backend.addFolder('归档');
    backend.recentFolderIds = [child.id, 'f2', idea.id, archive.id, 'deleted-in-another-tab'];

    controller.open(TWEET_ID, anchor);
    await settle();

    const recent = rows('最近使用');
    expect(recent).toHaveLength(RECENT_FOLDERS_MAX);
    expect(recent.map(nameOf)).toEqual(['学习 / 论文', '工作', '灵感']);
  });

  it('honours a collapsed parent in the full tree', async () => {
    backend.addFolder('论文', 'f1');
    controller.open(TWEET_ID, anchor);
    await settle();
    expect(rows('全部文件夹').map(nameOf)).toEqual(['学习', '论文', '工作']);

    click(rowFor('学习', '全部文件夹').querySelector('.xf-chevron'));
    await settle();

    expect(backend.folders[0]?.collapsed).toBe(true);
    expect(rows('全部文件夹').map(nameOf)).toEqual(['学习', '工作']);
  });

  it('closes on Escape and returns focus to the action button', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(hosts()).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);

    const button = TweetActionInjector.buttonFor(anchor);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    // Focus landed on the button itself, inside the anchor's closed root:
    // getRootNode() is the way back to that root from a node already in it.
    expect((button!.getRootNode() as ShadowRoot).activeElement).toBe(button);
    // And from the document's side, focus retargets to the host.
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on an outside pointerdown but not on one inside', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    panel()
      .querySelector('.xf-row-name')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    expect(hosts()).toHaveLength(1);

    anchor.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    expect(hosts()).toHaveLength(1);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    expect(hosts()).toHaveLength(0);
  });

  it('closes from ensure() once the anchor leaves the DOM', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    controller.ensure();
    expect(hosts()).toHaveLength(1);

    anchor.remove();
    controller.ensure();
    expect(hosts()).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);
  });

  it('drops a response that arrives after the popover closed', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    backend.holding = true;
    click(rowFor('工作', '全部文件夹').querySelector('.xf-row-name'));
    await settle();
    expect(backend.held.length).toBeGreaterThan(0);

    controller.close();
    backend.release();
    await settle();

    expect(changes).toEqual([]);
    expect(messages()).toEqual([]);
    expect(hosts()).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);
  });

  it('reports a failed save as a danger toast and stays open', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    backend.failNext = 'DATABASE_ERROR';
    click(rowFor('工作', '全部文件夹').querySelector('.xf-row-name'));
    await settle();

    expect(messages()).toEqual([messageFor('DATABASE_ERROR')]);
    expect(toasts.toasts[0]?.tone).toBe('danger');
    expect(changes).toEqual([]);
    expect(hosts()).toHaveLength(1);
  });

  it('refuses to save a tweet it can no longer extract', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();

    resolved = null;
    click(rowFor('工作', '全部文件夹').querySelector('.xf-row-name'));
    await settle();

    expect(backend.foldersHolding(TWEET_ID)).toEqual([]);
    expect(messages()).toEqual([messageFor('INVALID_TWEET_ID')]);
    expect(hosts()).toHaveLength(0);
  });

  it('takes every trace of itself off the page on dispose', async () => {
    controller.open(TWEET_ID, anchor);
    await settle();
    controller.dispose();
    expect(hosts()).toHaveLength(0);

    // A listener that outlived the popover would throw on the next event.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controller.isOpen()).toBe(false);
  });
});
