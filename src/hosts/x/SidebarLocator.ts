import { createLogger } from '@/utils/logger';
import { X_SELECTORS, XF_ATTR } from './selectors';

const log = createLogger('sidebar-locator');

/** Below this the nav renders icon-only and a full tree will not fit. */
export const NARROW_SIDEBAR_PX = 180;

/**
 * Below this much free height a full tree (header plus a row or two) cannot
 * fit without pushing X's account switcher off screen, so the compact entry is
 * used instead.
 */
export const WIDE_MIN_HEIGHT_PX = 96;

/** Breathing room kept between our host and the account switcher. */
const BUDGET_GAP_PX = 8;

/**
 * The height our host may take: whatever X's own column children leave free.
 * There is deliberately no floor — on real X a 753px window left 62px, and the
 * old 120px minimum pushed the account switcher off screen.
 */
export function sidebarBudget(columnHeight: number, otherHeights: readonly number[]): number {
  const used = otherHeights.reduce((sum, height) => sum + height, 0);
  return Math.max(0, columnHeight - used - BUDGET_GAP_PX);
}

export function chooseSidebarMode(width: number, budget: number): 'wide' | 'narrow' {
  // A zero width means the layout has not settled; assume wide and let the
  // health monitor re-evaluate rather than flipping to the compact UI on a
  // transient measurement.
  if (width === 0) return 'wide';
  if (width < NARROW_SIDEBAR_PX) return 'narrow';
  return budget < WIDE_MIN_HEIGHT_PX ? 'narrow' : 'wide';
}

/**
 * Free height in `column` for our host, or null while the column has not been
 * laid out. Measured from the column's own children rather than a fixed vh
 * value: the nav's height changes as X adds or removes items.
 */
export function measureBudget(column: HTMLElement): number | null {
  if (column.clientHeight === 0) return null;
  // X's column is a fixed, viewport-tall flex column, so its own height is the
  // room there is. A column that merely wraps its content has no such limit;
  // then it is the viewport below its top edge that must not be overflowed.
  const viewportRoom =
    (column.ownerDocument.defaultView?.innerHeight ?? 0) - column.getBoundingClientRect().top;
  const total = Math.max(column.clientHeight, viewportRoom);
  const others = Array.from(column.children)
    .filter((child) => !child.hasAttribute(XF_ATTR.sidebarHost))
    .map((child) => (child as HTMLElement).offsetHeight);
  return sidebarBudget(total, others);
}

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
  return chooseSidebarMode(width, measureBudget(column) ?? Number.POSITIVE_INFINITY);
}
