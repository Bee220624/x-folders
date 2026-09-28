import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderStore } from '@/state/FolderStore';
import { BASE_CSS, FEEDBACK_CSS } from '@/ui/shared/theme.css';
import { SIDEBAR_CSS } from '@/ui/sidebar/sidebar.css';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
}));
vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));

import { SidebarApp } from '@/ui/sidebar/SidebarApp';

options.requestAnimationFrame = (callback: () => void): void => callback();

const CSS = `${BASE_CSS}${FEEDBACK_CSS}${SIDEBAR_CSS}`;

function zIndexOf(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(CSS);
  if (match?.[1] === undefined) throw new Error(`no z-index for ${selector}`);
  return Number(match[1]);
}

describe('sidebar layering', () => {
  it('stacks the narrow panel below the menu, the dialog and the toasts', () => {
    // Seen on real X on 2026-09-29: the narrow panel sat above the context menu
    // and the delete dialog, so the menu was half covered and the panel's
    // click-outside layer swallowed the first click on 删除.
    const order = [
      '.xf-narrow-layer',
      '.xf-narrow-panel',
      '.xf-menu-layer',
      '.xf-dialog-backdrop',
      '.xf-toast-stack',
    ].map(zIndexOf);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  describe('narrow mode', () => {
    let container: HTMLElement;

    beforeEach(() => {
      rpcMock.mockReset().mockResolvedValue({ ok: true, data: { folders: [], recentFolderIds: [] } });
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      render(null, container);
      container.remove();
    });

    it('gives the panel its own click-outside layer, not the context menu’s', async () => {
      render(<SidebarApp store={new FolderStore()} mode="narrow" onOpenFolder={() => {}} />, container);
      await new Promise((resolve) => setTimeout(resolve, 0));
      container.querySelector<HTMLButtonElement>('.xf-narrow-button')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(container.querySelector('.xf-narrow-panel')).not.toBeNull();
      expect(container.querySelector('.xf-narrow-layer')).not.toBeNull();
      expect(container.querySelector('.xf-menu-layer')).toBeNull();
    });
  });
});
