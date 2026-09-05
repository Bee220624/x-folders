/**
 * Icon path data. Original geometry, drawn on X's 24x24 action-icon grid so the
 * button lines up with the native ones. No emoji, no remote assets.
 */
export const ICON_PATHS = {
  /** Outline folder — nothing saved yet. */
  folderOutline:
    'M3 6.25A2.25 2.25 0 0 1 5.25 4h3.38c.6 0 1.17.24 1.59.66l1.12 1.12h7.41A2.25 2.25 0 0 1 21 8.03v9.72A2.25 2.25 0 0 1 18.75 20H5.25A2.25 2.25 0 0 1 3 17.75V6.25Zm2.25-.75a.75.75 0 0 0-.75.75v11.5c0 .41.34.75.75.75h13.5c.41 0 .75-.34.75-.75V8.03a.75.75 0 0 0-.75-.75h-8.03L9.16 5.72a.75.75 0 0 0-.53-.22H5.25Z',
  /** Filled folder — saved in at least one folder. */
  folderFilled:
    'M3 6.25A2.25 2.25 0 0 1 5.25 4h3.38c.6 0 1.17.24 1.59.66l1.12 1.12h7.41A2.25 2.25 0 0 1 21 8.03v9.72A2.25 2.25 0 0 1 18.75 20H5.25A2.25 2.25 0 0 1 3 17.75V6.25Z',
  plus: 'M12 5a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5v-5.5A.75.75 0 0 1 12 5Z',
  chevronRight: 'M9 5.5 15.5 12 9 18.5l-1.06-1.06L13.38 12 7.94 6.56 9 5.5Z',
  check: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 12-12-1.4-1.4-10.6 10.6Z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z',
  more: 'M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  external:
    'M13 5h6v6h-1.5V7.56l-7.72 7.72-1.06-1.06L16.44 6.5H13V5Zm-7 2h4v1.5H6.5v9h9V13H17v6H5V7h1Z',
  trash:
    'M9 3h6l.75 1.5H19V6H5V4.5h3.25L9 3Zm-2.5 4.5h11l-.8 12.1a1.5 1.5 0 0 1-1.5 1.4H8.8a1.5 1.5 0 0 1-1.5-1.4L6.5 7.5Z',
} as const;

export type IconName = keyof typeof ICON_PATHS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds an SVG node with DOM APIs rather than assigning markup.
 *
 * The precise claim: no first-party code path turns a string into DOM. Nothing
 * in `src/` assigns `innerHTML`/`outerHTML`, calls `insertAdjacentHTML`, or
 * sets `dangerouslySetInnerHTML`. What ships is not string-free, though —
 * Preact's diff carries its own `dangerouslySetInnerHTML` branch, so that sink
 * is present in the bundle. It is unreachable because no component sets the
 * prop, and it stays unreachable because `no-restricted-syntax` in
 * `eslint.config.js` makes setting it a lint error.
 */
export function createIcon(name: IconName, size = 18.75): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}
