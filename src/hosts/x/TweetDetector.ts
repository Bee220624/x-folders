import { X_SELECTORS } from './selectors';

/**
 * Turns MutationRecords into the set of tweet roots that need attention.
 *
 * Never runs a whole-document `querySelectorAll` per mutation: only the added
 * nodes are inspected, in three cases — the node *is* a tweet root, it
 * *contains* tweet roots, or it sits *inside* one (X mutates tweet internals
 * constantly, e.g. when a like count changes).
 */
export function collectTweetRoots(records: readonly MutationRecord[]): Set<HTMLElement> {
  const found = new Set<HTMLElement>();

  const consider = (node: Node): void => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;

    if (element.matches(X_SELECTORS.tweetRoot)) {
      found.add(element);
      return;
    }
    const inside = element.closest<HTMLElement>(X_SELECTORS.tweetRoot);
    if (inside !== null) {
      found.add(inside);
      return;
    }
    for (const nested of element.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot)) {
      found.add(nested);
    }
  };

  for (const record of records) {
    for (const node of Array.from(record.addedNodes)) consider(node);
    if (record.type === 'attributes' || record.type === 'characterData') {
      consider(record.target);
    }
  }

  // A node that has already been detached is not worth any further work.
  for (const element of found) {
    if (!element.isConnected) found.delete(element);
  }
  return found;
}

/** Full scan, used on first run and after a route change. */
export function scanTweetRoots(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot)).filter(
    (element) => element.isConnected,
  );
}
