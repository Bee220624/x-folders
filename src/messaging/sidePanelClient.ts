import {
  OPEN_SIDE_PANEL,
  isSimpleResponse,
  type OpenSidePanelRequest,
  type SimpleResponse,
} from './sidePanelProtocol';

/**
 * Asks the background to open the side panel for this tab.
 *
 * Call it directly from the click handler: `sendMessage` runs synchronously
 * inside the Promise executor, which is what lets the background still treat
 * the request as part of the user's gesture.
 */
export function requestOpenSidePanel(): Promise<SimpleResponse> {
  const request: OpenSidePanelRequest = { kind: OPEN_SIDE_PANEL };
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(request, (response: unknown) => {
        const lastError = chrome.runtime.lastError;
        if (lastError !== undefined) {
          resolve({ ok: false, message: lastError.message ?? 'unavailable' });
          return;
        }
        resolve(isSimpleResponse(response) ? response : { ok: false, message: 'bad-response' });
      });
    } catch (error) {
      resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });
}
