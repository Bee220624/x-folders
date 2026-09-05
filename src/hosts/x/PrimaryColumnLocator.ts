import { createLogger } from '@/utils/logger';
import { X_SELECTORS } from './selectors';

const log = createLogger('primary-column');

/** Narrower than this a child of <main> is chrome (a spacer, a floating bar). */
const MIN_COLUMN_WIDTH_PX = 120;

export interface PrimaryColumnAnchor {
  column: HTMLElement;
  /** Measured at locate time; callers must not cache it across a layout. */
  rect: DOMRect;
}

/**
 * The `<main>` landmark, reached through `getElementsByTagName` rather than a
 * selector string: it is standard HTML, not an X-specific hook, and it is the
 * one anchor that survives a `data-testid` rename.
 */
function mainLandmark(doc: Document): HTMLElement | null {
  const mains = Array.from(doc.getElementsByTagName('main'));
  const landmark = mains.find((element) => element.getAttribute('role') === 'main') ?? mains[0];
  return landmark instanceof HTMLElement ? landmark : null;
}

/**
 * Finds the column the folder view overlays. Only the primary column is
 * covered, so X's left navigation and right-hand column stay usable.
 */
export function locatePrimaryColumn(doc: Document = document): PrimaryColumnAnchor | null {
  const column = doc.querySelector<HTMLElement>(X_SELECTORS.primaryColumn);
  if (column !== null) return { column, rect: column.getBoundingClientRect() };

  const main = mainLandmark(doc);
  if (main === null) return null;

  for (const child of Array.from(main.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const rect = child.getBoundingClientRect();
    // A zero width means the layout has not been measured yet; accepting it
    // beats reporting "no column" on a transient frame, and the caller
    // re-aligns on the next resize anyway.
    if (rect.width !== 0 && rect.width < MIN_COLUMN_WIDTH_PX) continue;
    log.debug('primaryColumn testid missing, using main child');
    return { column: child, rect };
  }
  return null;
}
