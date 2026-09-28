import { isOpenSidePanelRequest, type SimpleResponse } from '@/messaging/sidePanelProtocol';
import { createLogger } from '@/utils/logger';

const log = createLogger('side-panel');

/**
 * Two ways into the side panel: the toolbar icon, and a click inside x.com.
 *
 * `chrome.sidePanel.open()` is only honoured while the user gesture that led to
 * it is still live, so it is called synchronously inside the listener —
 * before anything is awaited — for the sender's own tab.
 *
 * Must be called synchronously at worker start, like the RPC listener.
 */
export function registerSidePanel(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => log.warn('setPanelBehavior failed', error));

  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: SimpleResponse) => void,
    ): boolean => {
      if (!isOpenSidePanelRequest(message)) return false;
      const reply = (response: SimpleResponse): void => {
        try {
          sendResponse(response);
        } catch (error) {
          log.debug('response channel closed', error);
        }
      };
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        reply({ ok: false, message: 'no-tab' });
        return false;
      }
      chrome.sidePanel
        .open({ tabId })
        .then(() => reply({ ok: true }))
        .catch((error: unknown) => {
          log.warn('sidePanel.open failed', error);
          reply({ ok: false, message: error instanceof Error ? error.message : String(error) });
        });
      return true;
    },
  );
}
