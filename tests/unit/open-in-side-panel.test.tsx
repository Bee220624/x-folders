import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderStore } from '@/state/FolderStore';
import { FolderViewApp } from '@/ui/folder-view/FolderViewApp';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(method: string, payload: unknown) => Promise<unknown>>(),
}));
vi.mock('@/messaging/RpcClient', () => ({ rpc: rpcMock, rpcOrNull: vi.fn() }));

options.requestAnimationFrame = (callback: () => void): void => callback();

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const BUTTON = 'button[aria-label="在侧边栏中打开"]';

describe('the overlay’s side panel button', () => {
  let container: HTMLElement;

  beforeEach(() => {
    rpcMock.mockReset().mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('is offered on the page overlay and hands the click straight over', async () => {
    const onOpenInSidePanel = vi.fn();
    render(
      <FolderViewApp
        store={new FolderStore()}
        folderId="f1"
        onClose={() => {}}
        onMembershipChanged={() => {}}
        onOpenInSidePanel={onOpenInSidePanel}
      />,
      container,
    );
    await flush();
    const button = container.querySelector<HTMLButtonElement>(BUTTON);
    expect(button).not.toBeNull();
    button?.click();
    expect(onOpenInSidePanel).toHaveBeenCalledTimes(1);
  });

  it('is not offered inside the side panel itself', async () => {
    render(
      <FolderViewApp
        store={new FolderStore()}
        folderId="f1"
        onClose={() => {}}
        onMembershipChanged={() => {}}
      />,
      container,
    );
    await flush();
    expect(container.querySelector(BUTTON)).toBeNull();
  });
});
