import { isInsideAny } from '@/utils/dom';
import { quoteSubtrees } from './TweetExtractor';
import { ACTION_SELECTORS, X_SELECTORS } from './selectors';

export interface ActionGroupMatch {
  group: HTMLElement;
  /** The direct child of `group` holding the bookmark button, when present. */
  bookmarkSlot: HTMLElement | null;
  score: number;
}

/**
 * Finds the real action bar inside a tweet.
 *
 * Picking "the first div[role=group]" is not safe — X uses role=group for other
 * clusters too. A candidate must contain at least two recognised actions, and a
 * group containing the bookmark button wins ties.
 *
 * Observed on real X (2026-09): the composition differs per surface —
 *   home/profile/search : reply | repost | like | views(a) | share(button)
 *   status detail       : reply | repost | like | bookmark | share
 * so bookmark is frequently absent and appending to the end of the group is the
 * normal path, not a rare fallback.
 */
export function findActionGroup(root: HTMLElement): ActionGroupMatch | null {
  const quotes = quoteSubtrees(root);
  let best: ActionGroupMatch | null = null;

  for (const candidate of root.querySelectorAll<HTMLElement>(X_SELECTORS.actionGroup)) {
    if (isInsideAny(candidate, quotes)) continue;

    let score = 0;
    for (const selector of ACTION_SELECTORS) {
      if (candidate.querySelector(selector) !== null) score += 1;
    }
    if (score < 2) continue;

    const bookmark = candidate.querySelector(X_SELECTORS.bookmark);
    const bookmarkSlot =
      bookmark === null ? null : directChildContaining(candidate, bookmark);
    // Bookmark presence is the strongest signal that this is the action bar.
    const weighted = score + (bookmarkSlot === null ? 0 : 10);
    if (best === null || weighted > best.score) {
      best = { group: candidate, bookmarkSlot, score: weighted };
    }
  }

  return best;
}

/** Walks up from `descendant` to the direct child of `parent` that contains it. */
export function directChildContaining(parent: Element, descendant: Element): HTMLElement | null {
  let current: Element | null = descendant;
  while (current !== null && current.parentElement !== parent) {
    current = current.parentElement;
  }
  return current instanceof HTMLElement ? current : null;
}
