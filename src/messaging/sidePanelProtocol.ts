/**
 * Messages that deliberately live outside the RPC table, because each has a
 * constraint the generic RPC path would hide:
 *  - opening the side panel must happen synchronously inside the background
 *    listener, while the user's click still counts as a gesture;
 *  - navigation requests go *to* a content script, which RPC never does.
 */

export const OPEN_SIDE_PANEL = 'xf:open-side-panel';
export const NAVIGATE_TO_POST = 'xf:navigate';

export interface OpenSidePanelRequest {
  kind: typeof OPEN_SIDE_PANEL;
}

export interface NavigateRequest {
  kind: typeof NAVIGATE_TO_POST;
  url: string;
}

export interface SimpleResponse {
  ok: boolean;
  message?: string;
}

function kindOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? (value as { kind?: unknown }).kind
    : undefined;
}

export function isOpenSidePanelRequest(value: unknown): value is OpenSidePanelRequest {
  return kindOf(value) === OPEN_SIDE_PANEL;
}

export function isNavigateRequest(value: unknown): value is NavigateRequest {
  return (
    kindOf(value) === NAVIGATE_TO_POST && typeof (value as { url?: unknown }).url === 'string'
  );
}

export function isSimpleResponse(value: unknown): value is SimpleResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}
