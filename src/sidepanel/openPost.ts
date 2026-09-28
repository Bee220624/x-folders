import {
  NAVIGATE_TO_POST,
  isSimpleResponse,
  type NavigateRequest,
} from '@/messaging/sidePanelProtocol';
import { isSafeXUrl } from '@/utils/url';

export interface OpenPostOptions {
  /** ⌘/Ctrl-click: always a new tab. */
  newTab: boolean;
}

/**
 * Opens a saved post from the side panel.
 *
 * The panel is an extension page: following the link itself would navigate
 * the panel, not the page beside it. The active tab is asked first — if it is
 * an X tab, our content script answers and navigates itself, which needs no
 * `tabs` permission. Anything else (a non-X tab, no answer) gets a new tab.
 */
export async function openPost(url: string, options: OpenPostOptions): Promise<void> {
  if (!isSafeXUrl(url)) return;
  if (!options.newTab) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined && (await askTabToNavigate(tab.id, url))) return;
  }
  await chrome.tabs.create({ url });
}

function askTabToNavigate(tabId: number, url: string): Promise<boolean> {
  const request: NavigateRequest = { kind: NAVIGATE_TO_POST, url };
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, request, (response: unknown) => {
        // Reading lastError is what marks "no content script there" as handled.
        if (chrome.runtime.lastError !== undefined) {
          resolve(false);
          return;
        }
        resolve(isSimpleResponse(response) && response.ok);
      });
    } catch {
      resolve(false);
    }
  });
}
