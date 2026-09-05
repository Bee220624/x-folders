import { createLogger } from '@/utils/logger';
import { X_SELECTORS } from './selectors';

const log = createLogger('sidebar-locator');

/** Below this the nav renders icon-only and a full tree will not fit. */
export const NARROW_SIDEBAR_PX = 180;

export interface SidebarAnchor {
  /** The scrollable flex column holding the logo, nav, post button and switcher. */
  column: HTMLElement;
  /** Insert our host immediately before this node, or append when null. */
  before: HTMLElement | null;
  mode: 'wide' | 'narrow';
  /** Which strategy matched, for the selector-health log. */
  via: 'common-ancestor' | 'nav-parent' | 'banner-child';
}

function commonAncestor(a: Element, b: Element): HTMLElement | null {
  const ancestors = new Set<Element>();
  for (let node: Element | null = a; node !== null; node = node.parentElement) ancestors.add(node);
  for (let node: Element | null = b; node !== null; node = node.parentElement) {
    if (ancestors.has(node)) return node instanceof HTMLElement ? node : null;
  }
  return null;
}

/** The direct child of `column` that contains `descendant`. */
function slotOf(column: Element, descendant: Element): HTMLElement | null {
  let current: Element | null = descendant;
  while (current !== null && current.parentElement !== column) current = current.parentElement;
  return current instanceof HTMLElement ? current : null;
}

/**
 * Locates where the folder tree should live in X's left navigation.
 *
 * Anchored structurally, never positionally. The real column is the nearest
 * common ancestor of `<nav>` and the account-switcher button — a single
 * scrollable flex column. Inserting immediately *before* the switcher's own slot
 * keeps the switcher pinned at the bottom where users expect it, and keeps our
 * tree below the Post button.
 */
export function locateSidebar(doc: Document = document): SidebarAnchor | null {
  const nav = doc.querySelector<HTMLElement>(X_SELECTORS.navRoot);
  const switcher = doc.querySelector<HTMLElement>(X_SELECTORS.accountSwitcher);

  if (nav !== null && switcher !== null) {
    const column = commonAncestor(nav, switcher);
    if (column !== null) {
      return {
        column,
        before: slotOf(column, switcher),
        mode: modeOf(column, nav),
        via: 'common-ancestor',
      };
    }
  }

  if (nav !== null && nav.parentElement !== null) {
    log.debug('sidebar fallback: nav-parent');
    return { column: nav.parentElement, before: null, mode: modeOf(nav.parentElement, nav), via: 'nav-parent' };
  }

  const banner = doc.querySelector<HTMLElement>(X_SELECTORS.banner);
  const child = banner?.firstElementChild;
  if (child instanceof HTMLElement) {
    log.debug('sidebar fallback: banner-child');
    return { column: child, before: null, mode: modeOf(child, child), via: 'banner-child' };
  }

  return null;
}

function modeOf(column: HTMLElement, nav: HTMLElement): 'wide' | 'narrow' {
  const width = column.clientWidth || nav.clientWidth;
  // A zero width means the layout has not settled; assume wide and let the
  // health monitor re-evaluate rather than flipping to the compact UI on a
  // transient measurement.
  if (width === 0) return 'wide';
  return width < NARROW_SIDEBAR_PX ? 'narrow' : 'wide';
}

/**
 * Space the tree may occupy without pushing the account switcher off screen.
 * Computed from the column's own children rather than a fixed vh value: the
 * nav's height changes as X adds or removes items.
 */
export function availableHeight(anchor: SidebarAnchor, hostElement: Element | null): number {
  const total = anchor.column.clientHeight;
  if (total === 0) return 240;
  let used = 0;
  for (const child of Array.from(anchor.column.children)) {
    if (child === hostElement) continue;
    used += (child as HTMLElement).offsetHeight;
  }
  return Math.max(120, total - used - 8);
}
