import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeAdapter, detectTheme, tokensFor } from '@/hosts/x/ThemeAdapter';
import { FolderStore } from '@/state/FolderStore';
import { VisibleTweetStore } from '@/state/VisibleTweetStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { CHANGE_CHANNEL_KEY } from '@/core/constants';
import type { RpcMethod } from '@/messaging/protocol';

/** Replaces chrome.runtime.sendMessage with a scripted responder. */
function mockRpc(responder: (method: RpcMethod, payload: unknown) => unknown): void {
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
    message: unknown,
    callback: (response: unknown) => void,
  ) => {
    const request = message as { method: RpcMethod; payload: unknown };
    queueMicrotask(() => callback({ ok: true, data: responder(request.method, request.payload) }));
    return undefined;
  }) as typeof chrome.runtime.sendMessage);
}

describe('ThemeAdapter', () => {
  afterEach(() => {
    document.body.removeAttribute('style');
    vi.restoreAllMocks();
  });

  it('classifies X’s three themes from the body background', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    expect(detectTheme(document)).toBe('light');
    document.body.style.backgroundColor = 'rgb(21, 32, 43)';
    expect(detectTheme(document)).toBe('dim');
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    expect(detectTheme(document)).toBe('lightsOut');
  });

  it('gives every theme a readable text colour, never a browser default', () => {
    for (const theme of ['light', 'dim', 'lightsOut'] as const) {
      const tokens = tokensFor(theme);
      expect(tokens['--xf-text']).toMatch(/^rgb/);
      expect(tokens['--xf-bg']).toMatch(/^rgb/);
      // Lights Out is the case that breaks if text colour is derived from
      // getComputedStyle: it would come back near-black on a black background.
      expect(tokens['--xf-text']).not.toBe(tokens['--xf-bg']);
    }
  });

  it('writes tokens onto registered hosts and never onto the page', () => {
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    const adapter = new ThemeAdapter(document);
    const host = document.createElement('div');
    adapter.register(host);

    expect(host.style.getPropertyValue('--xf-bg')).toBe('rgb(0, 0, 0)');
    // X's own element must be untouched apart from the background we read.
    expect(document.documentElement.style.getPropertyValue('--xf-bg')).toBe('');
  });

  it('re-applies tokens when X switches theme', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    const adapter = new ThemeAdapter(document);
    const host = document.createElement('div');
    adapter.register(host);
    expect(adapter.theme).toBe('light');

    document.body.style.backgroundColor = 'rgb(21, 32, 43)';
    adapter.refresh();
    expect(adapter.theme).toBe('dim');
    expect(host.style.getPropertyValue('--xf-bg')).toBe('rgb(21, 32, 43)');
  });

  it('notifies listeners only on an actual change', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    const adapter = new ThemeAdapter(document);
    const listener = vi.fn();
    adapter.onChange(listener);

    adapter.refresh();
    expect(listener).not.toHaveBeenCalled();

    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    adapter.refresh();
    expect(listener).toHaveBeenCalledExactlyOnceWith('lightsOut');
  });
});

describe('FolderStore', () => {
  let registry: CleanupRegistry;

  beforeEach(() => {
    registry = new CleanupRegistry();
  });

  afterEach(() => {
    registry.dispose();
    vi.restoreAllMocks();
  });

  it('builds a tree from the snapshot', async () => {
    mockRpc(() => ({
      folders: [
        { id: 'r', name: 'Root', parentId: null, position: 1000, collapsed: false, createdAt: 1, updatedAt: 1, tweetCount: 2 },
        { id: 'c', name: 'Child', parentId: 'r', position: 1000, collapsed: false, createdAt: 2, updatedAt: 2, tweetCount: 1 },
      ],
      recentFolderIds: ['c'],
    }));

    const store = new FolderStore();
    await store.refresh();
    expect(store.state.tree).toHaveLength(1);
    expect(store.state.tree[0]?.children[0]?.name).toBe('Child');
    expect(store.state.recentFolderIds).toEqual(['c']);
    expect(store.state.loading).toBe(false);
  });

  it('drops an active folder that no longer exists', async () => {
    let folders: unknown[] = [
      { id: 'gone', name: 'Gone', parentId: null, position: 1000, collapsed: false, createdAt: 1, updatedAt: 1, tweetCount: 0 },
    ];
    mockRpc(() => ({ folders, recentFolderIds: [] }));

    const store = new FolderStore();
    await store.refresh();
    store.setActiveFolder('gone');
    expect(store.state.activeFolderId).toBe('gone');

    // Deleted in another tab.
    folders = [];
    await store.refresh();
    expect(store.state.activeFolderId).toBeNull();
  });

  it('discards a stale in-flight snapshot', async () => {
    const responses = [
      { folders: [], recentFolderIds: ['stale'] },
      { folders: [], recentFolderIds: ['fresh'] },
    ];
    let call = 0;
    const delays = [30, 0];
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
      _message: unknown,
      callback: (response: unknown) => void,
    ) => {
      const index = call++;
      setTimeout(() => callback({ ok: true, data: responses[index] }), delays[index]);
      return undefined;
    }) as typeof chrome.runtime.sendMessage);

    const store = new FolderStore();
    const slow = store.refresh();
    const fast = store.refresh();
    await Promise.all([slow, fast]);
    // The slower earlier request must not overwrite the newer snapshot.
    expect(store.state.recentFolderIds).toEqual(['fresh']);
  });

  it('refreshes when the cross-tab change channel fires', async () => {
    mockRpc(() => ({ folders: [], recentFolderIds: [] }));
    const store = new FolderStore();
    store.attach(registry);
    const spy = vi.spyOn(store, 'refresh');

    await chrome.storage.local.set({
      [CHANGE_CHANNEL_KEY]: {
        type: 'xf:database-changed',
        revision: 1,
        foldersChanged: true,
        affectedFolderIds: [],
        affectedTweetIds: [],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(spy).toHaveBeenCalled();
  });

  it('ignores unrelated storage writes', async () => {
    mockRpc(() => ({ folders: [], recentFolderIds: [] }));
    const store = new FolderStore();
    store.attach(registry);
    const spy = vi.spyOn(store, 'refresh');

    await chrome.storage.local.set({ 'something:else': { hello: true } });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('VisibleTweetStore', () => {
  let registry: CleanupRegistry;

  beforeEach(() => {
    registry = new CleanupRegistry();
  });

  afterEach(() => {
    registry.dispose();
    vi.restoreAllMocks();
  });

  it('merges a burst of tracked ids into one RPC', async () => {
    const batches: string[][] = [];
    mockRpc((_method, payload) => {
      const ids = (payload as { tweetIds: string[] }).tweetIds;
      batches.push(ids);
      return Object.fromEntries(ids.map((id) => [id, id === '1' ? 2 : 0]));
    });

    const store = new VisibleTweetStore();
    store.attach(registry);
    store.track(['1', '2']);
    store.track(['3']);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(batches).toHaveLength(1);
    expect(batches[0]?.sort()).toEqual(['1', '2', '3']);
    expect(store.countFor('1')).toBe(2);
    // An unsaved tweet is written back as 0, which is what clears a stale icon.
    expect(store.countFor('2')).toBe(0);
  });

  it('splits batches above the 100-id cap', async () => {
    const sizes: number[] = [];
    mockRpc((_method, payload) => {
      const ids = (payload as { tweetIds: string[] }).tweetIds;
      sizes.push(ids.length);
      return Object.fromEntries(ids.map((id) => [id, 0]));
    });

    const store = new VisibleTweetStore();
    store.attach(registry);
    store.track(Array.from({ length: 250 }, (_, i) => String(i)));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sizes).toEqual([100, 100, 50]);
  });

  it('does not re-request ids it already knows', async () => {
    let calls = 0;
    mockRpc((_method, payload) => {
      calls += 1;
      const ids = (payload as { tweetIds: string[] }).tweetIds;
      return Object.fromEntries(ids.map((id) => [id, 1]));
    });

    const store = new VisibleTweetStore();
    store.attach(registry);
    store.track(['1']);
    await new Promise((resolve) => setTimeout(resolve, 120));
    store.track(['1']);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toBe(1);

    // invalidate() forces a refetch after a write.
    store.invalidate(['1']);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toBe(2);
  });

  it('drops ids that scrolled out of view', () => {
    const store = new VisibleTweetStore();
    store.setLocal('1', 1);
    store.setLocal('2', 1);
    store.retain(new Set(['1']));
    expect(store.countFor('1')).toBe(1);
    expect(store.countFor('2')).toBe(0);
  });
});
