import { options } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeAdapter } from '@/hosts/x/ThemeAdapter';
import { FolderStore } from '@/state/FolderStore';
import { CleanupRegistry } from '@/utils/cleanup';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
}));
vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));

import { chooseSidebarMode, sidebarBudget, WIDE_MIN_HEIGHT_PX } from '@/hosts/x/SidebarLocator';
import { SidebarMount } from '@/hosts/x/SidebarMount';

options.requestAnimationFrame = (callback: () => void): void => callback();

/** jsdom does no layout, so the real X measurements are pinned onto the nodes. */
function pin(id: string, sizes: Record<string, number>): void {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(element, key, { configurable: true, value });
  }
}

describe('sidebar height budget', () => {
  it('takes only what X leaves free, never a fixed minimum', () => {
    // Real X, 2026-09-29: a 753px column, 625px of X's own navigation and a
    // 66px account switcher leave 62px — the old 120px floor pushed the
    // switcher off screen.
    expect(sidebarBudget(753, [625, 66])).toBe(54);
    expect(sidebarBudget(1000, [625, 66])).toBe(301);
    expect(sidebarBudget(600, [625, 66])).toBe(0);
  });

  it('falls back to the compact entry when a full tree would not fit', () => {
    expect(chooseSidebarMode(260, 54)).toBe('narrow');
    expect(chooseSidebarMode(260, WIDE_MIN_HEIGHT_PX)).toBe('wide');
    expect(chooseSidebarMode(88, 500)).toBe('narrow');
    // Width 0: not laid out yet — stay wide and let the health tick re-check.
    expect(chooseSidebarMode(0, 0)).toBe('wide');
  });

  describe('SidebarMount', () => {
    let registry: CleanupRegistry;
    const jsdomInnerHeight = window.innerHeight;

    beforeEach(() => {
      // The real page: a 753px window whose navigation column fills it.
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 753 });
      rpcMock.mockReset().mockResolvedValue({ ok: true, data: { folders: [], recentFolderIds: [] } });
      registry = new CleanupRegistry();
      document.body.innerHTML = `
        <header role="banner"><div id="col">
          <div id="top"><nav><a data-testid="AppTabBar_Home_Link"></a></nav></div>
          <div id="bottom"><div data-testid="SideNav_AccountSwitcher_Button"></div></div>
        </div></header>`;
      pin('top', { offsetHeight: 625 });
      pin('bottom', { offsetHeight: 66 });
    });

    afterEach(() => {
      registry.dispose();
      document.body.innerHTML = '';
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: jsdomInnerHeight });
    });

    function mountWithColumnHeight(height: number): HTMLElement | null {
      pin('col', { clientHeight: height, clientWidth: 260 });
      const mount = new SidebarMount({
        store: new FolderStore(),
        theme: new ThemeAdapter(),
        registry,
        onOpenFolder: () => {},
      });
      mount.ensure();
      return document.querySelector<HTMLElement>('[data-xf-sidebar-host]');
    }

    it('caps the whole host to the free height and goes compact on a short window', () => {
      const host = mountWithColumnHeight(753);
      expect(host?.getAttribute('data-xf-mode')).toBe('narrow');
      expect(host?.style.maxHeight).toBe('54px');
    });

    it('keeps the full tree when there is room, still capped', () => {
      const host = mountWithColumnHeight(1000);
      expect(host?.getAttribute('data-xf-mode')).toBe('wide');
      expect(host?.style.maxHeight).toBe('301px');
    });
  });
});
