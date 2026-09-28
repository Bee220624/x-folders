import { isNavigateRequest, type SimpleResponse } from '@/messaging/sidePanelProtocol';
import type { CleanupRegistry } from '@/utils/cleanup';
import { isSafeXUrl } from '@/utils/url';

/**
 * Lets the side panel open a saved post in this tab.
 *
 * The URL is re-checked here: it crossed a context boundary and is treated as
 * untrusted. The reply goes out *before* navigating, because navigating tears
 * this content script down and the side panel would otherwise wait for an
 * answer that never comes.
 */
export function listenForNavigateRequests(
  registry: CleanupRegistry,
  navigate: (url: string) => void = (url) => location.assign(url),
): void {
  const listener = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: SimpleResponse) => void,
  ): boolean => {
    if (!isNavigateRequest(message)) return false;
    if (!isSafeXUrl(message.url)) {
      sendResponse({ ok: false, message: 'unsafe-url' });
      return false;
    }
    sendResponse({ ok: true });
    navigate(message.url);
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  registry.add(() => chrome.runtime.onMessage.removeListener(listener));
}
