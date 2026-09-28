import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForNavigateRequests } from '@/hosts/x/NavigateHandler';
import { NAVIGATE_TO_POST, type SimpleResponse } from '@/messaging/sidePanelProtocol';
import { CleanupRegistry } from '@/utils/cleanup';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: SimpleResponse) => void,
) => boolean;

const POST = 'https://x.com/alice/status/1000000000000000001';

describe('navigate requests from the side panel', () => {
  const navigate = vi.fn<(url: string) => void>();
  let registry: CleanupRegistry;
  let listener: Listener;

  beforeEach(() => {
    navigate.mockReset();
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(chrome.runtime.onMessage.removeListener).mockClear();
    registry = new CleanupRegistry();
    listenForNavigateRequests(registry, navigate);
    listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]?.[0] as unknown as Listener;
  });

  it('answers first, then navigates to a safe x.com post', () => {
    const sendResponse = vi.fn();
    listener({ kind: NAVIGATE_TO_POST, url: POST }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(navigate).toHaveBeenCalledWith(POST);
    expect(sendResponse.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('refuses anything that is not an https x.com URL', () => {
    for (const url of ['javascript:alert(1)', 'https://evil.example/x', 'http://x.com/a/status/1']) {
      const sendResponse = vi.fn();
      listener({ kind: NAVIGATE_TO_POST, url }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores other messages', () => {
    const sendResponse = vi.fn();
    expect(listener({ kind: 'xf:rpc' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('stops listening when the content script is disposed', () => {
    registry.dispose();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });
});
