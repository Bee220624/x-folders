import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSidePanel } from '@/background/sidePanel';
import { requestOpenSidePanel } from '@/messaging/sidePanelClient';
import { OPEN_SIDE_PANEL, type SimpleResponse } from '@/messaging/sidePanelProtocol';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: SimpleResponse) => void,
) => boolean;

describe('background side panel opener', () => {
  const open = vi.fn<(options: { tabId: number }) => Promise<void>>();
  const setPanelBehavior = vi.fn<(behavior: { openPanelOnActionClick: boolean }) => Promise<void>>();
  let listener: Listener;

  beforeEach(() => {
    open.mockReset().mockResolvedValue(undefined);
    setPanelBehavior.mockReset().mockResolvedValue(undefined);
    Object.assign(chrome, { sidePanel: { open, setPanelBehavior } });
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    registerSidePanel();
    const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    listener = calls[calls.length - 1]?.[0] as unknown as Listener;
  });

  it('lets the toolbar icon open the panel', () => {
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('opens the panel for the sender tab synchronously, inside the gesture', async () => {
    const sendResponse = vi.fn();
    const keepChannelOpen = listener(
      { kind: OPEN_SIDE_PANEL },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );
    // Called before the listener returned: nothing was awaited first.
    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
  });

  it('reports a refusal instead of throwing', async () => {
    open.mockRejectedValue(new Error('may only be called in response to a user gesture'));
    const sendResponse = vi.fn();
    listener({ kind: OPEN_SIDE_PANEL }, { tab: { id: 7 } as chrome.tabs.Tab }, sendResponse);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false })),
    );
  });

  it('leaves every other message to the RPC listener', () => {
    const sendResponse = vi.fn();
    expect(listener({ kind: 'xf:rpc', method: 'health.ping' }, {}, sendResponse)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe('requestOpenSidePanel', () => {
  beforeEach(() => {
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    delete (chrome.runtime as { lastError?: { message: string } }).lastError;
  });

  it('sends the request synchronously, while the click is still a gesture', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      ((_message: unknown, callback: (response: unknown) => void) => callback({ ok: true })) as never,
    );
    const pending = requestOpenSidePanel();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { kind: OPEN_SIDE_PANEL },
      expect.any(Function),
    );
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('turns an unreachable background into a plain failure', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      ((_message: unknown, callback: (response: unknown) => void) => {
        (chrome.runtime as { lastError?: { message: string } }).lastError = {
          message: 'Extension context invalidated.',
        };
        callback(undefined);
        delete (chrome.runtime as { lastError?: { message: string } }).lastError;
      }) as never,
    );
    await expect(requestOpenSidePanel()).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
  });
});
