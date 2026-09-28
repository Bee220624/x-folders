import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openPost } from '@/sidepanel/openPost';

const POST = 'https://x.com/alice/status/1000000000000000001';

function setLastError(value: { message: string } | undefined): void {
  if (value === undefined) delete (chrome.runtime as { lastError?: { message: string } }).lastError;
  else (chrome.runtime as { lastError?: { message: string } }).lastError = value;
}

describe('opening a post from the side panel', () => {
  const query = vi.fn<(info: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>>();
  const create = vi.fn<(props: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>();
  const sendMessage =
    vi.fn<(tabId: number, message: unknown, callback: (response: unknown) => void) => void>();

  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ id: 42 } as chrome.tabs.Tab]);
    create.mockReset().mockResolvedValue({ id: 43 } as chrome.tabs.Tab);
    sendMessage.mockReset();
    setLastError(undefined);
    Object.assign(chrome, { tabs: { query, create, sendMessage } });
  });

  it('asks the active X tab to navigate, and opens nothing else', async () => {
    sendMessage.mockImplementation((_tabId, _message, callback) => callback({ ok: true }));
    await openPost(POST, { newTab: false });
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(
      42,
      { kind: 'xf:navigate', url: POST },
      expect.any(Function),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to a new tab when the active tab has no X content script', async () => {
    sendMessage.mockImplementation((_tabId, _message, callback) => {
      setLastError({ message: 'Could not establish connection. Receiving end does not exist.' });
      callback(undefined);
      setLastError(undefined);
    });
    await openPost(POST, { newTab: false });
    expect(create).toHaveBeenCalledWith({ url: POST });
  });

  it('opens a new tab straight away when asked to', async () => {
    await openPost(POST, { newTab: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ url: POST });
  });

  it('never opens a URL that is not an x.com post link', async () => {
    await openPost('javascript:alert(1)', { newTab: true });
    expect(create).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
