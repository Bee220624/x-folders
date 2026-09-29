import { segmentsToText } from '@/core/domain/snapshot';
import type { TweetRecord } from '@/core/domain/tweet';
import { findWhere, isInsideAny } from '@/utils/dom';
import { parseStatusUrl } from '@/utils/url';
import { readAuthor } from './extractAuthor';
import { readCard, readMedia } from './extractMedia';
import { readTime } from './extractPicture';
import { readQuote } from './extractQuote';
import { readSegments } from './extractText';
import { X_SELECTORS } from './selectors';

/**
 * Extraction is tri-state, not `TweetRecord | null`.
 *
 * Treating every failure as transient turns permanently unextractable nodes —
 * promoted posts, "this post is unavailable" placeholders — into an endless
 * re-scan loop for the health monitor. `skip` says "never ask again".
 */
export type ExtractOutcome =
  | { status: 'ok'; record: TweetRecord }
  | { status: 'retry'; reason: string }
  | { status: 'skip'; reason: string };

export interface ExtractContext {
  /** Usually `location.pathname`; injected so tests need no navigation. */
  pathname: string;
  now: number;
}

const PAGE_STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:\/|$)/;

/**
 * The quoted-tweet subtree(s) of `root`.
 *
 * This is the guard the work order got wrong. A quoted tweet is not a nested
 * `[data-testid="tweet"]`, so `node.closest(tweetRoot) === root` is true for
 * everything inside the quote and excludes nothing. Ancestry against the real
 * quote container is what actually separates the two tweets.
 */
export function quoteSubtrees(root: Element): Element[] {
  return Array.from(root.querySelectorAll(X_SELECTORS.quoteContainer)).filter(
    (candidate) =>
      candidate !== root &&
      (candidate.querySelector(X_SELECTORS.tweetText) !== null ||
        candidate.querySelector(X_SELECTORS.userName) !== null),
  );
}

/**
 * Resolves the outer tweet's permalink anchor.
 *
 * One rule covers both surfaces: the anchor must be outside every quote subtree
 * and must contain a `<time>`.
 *  - Home/profile/search: that anchor sits inside `[data-testid="User-Name"]`.
 *  - Status pages: the subject tweet has NO time in its header at all — the
 *    timestamp lives in a separate permalink row below the body, and the same
 *    rule finds it.
 * Requiring a `<time>` also drops the `/analytics` and `/quotes` anchors, which
 * are real status links pointing at the same id with a suffix.
 */
export function findIdentityAnchor(root: Element, quotes: readonly Element[]): HTMLAnchorElement | null {
  const anchor = findWhere(
    root,
    X_SELECTORS.statusLink,
    (candidate) =>
      !isInsideAny(candidate, quotes) && candidate.querySelector(X_SELECTORS.time) !== null,
  );
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

function isPromoted(root: Element): boolean {
  return (
    root.closest(X_SELECTORS.promoted) !== null || root.querySelector(X_SELECTORS.promoted) !== null
  );
}

export function extractTweet(root: Element, context: ExtractContext): ExtractOutcome {
  const quotes = quoteSubtrees(root);
  const anchor = findIdentityAnchor(root, quotes);

  // Genuine ads carry no timestamped permalink, so they are skipped by marker
  // rather than by failure — that is what stops the 2s watchdog re-testing
  // every ad on the page forever. The marker alone is not enough, though: on
  // real X (2026-09-29) placementTracking also sits on ordinary, unlabelled
  // posts, and skipping those made them impossible to save. A real permalink
  // therefore wins over the marker.
  if (anchor === null && isPromoted(root)) {
    return { status: 'skip', reason: 'promoted' };
  }

  let username: string;
  let tweetId: string;
  let canonicalUrl: string;

  if (anchor !== null) {
    // `.href` (the property) is absolute; `getAttribute('href')` is a relative
    // path like /user/status/123 and would fail an absolute-URL pattern.
    const parsed = parseStatusUrl(anchor.href);
    if (parsed === null) return { status: 'skip', reason: 'unparsable-permalink' };
    ({ username, tweetId, canonicalUrl } = parsed);
  } else {
    const onStatusPage = PAGE_STATUS_PATH.exec(context.pathname);
    const isFocused = root.matches(X_SELECTORS.focusedTweet);
    if (onStatusPage !== null && isFocused) {
      // Last resort for a subject tweet whose permalink row has not rendered.
      const pageUser = onStatusPage[1];
      const pageId = onStatusPage[2];
      if (pageUser === undefined || pageId === undefined) {
        return { status: 'retry', reason: 'bad-page-path' };
      }
      username = pageUser;
      tweetId = pageId;
      canonicalUrl = `https://x.com/${pageUser}/status/${pageId}`;
    } else if (root.querySelector(X_SELECTORS.userName) !== null) {
      // A rendered header with no permalink anywhere is an unavailable or
      // deleted post: it will never become extractable.
      return { status: 'skip', reason: 'no-permalink' };
    } else {
      return { status: 'retry', reason: 'not-rendered' };
    }
  }

  const author = readAuthor(root, quotes);
  const textRoot = findWhere(root, X_SELECTORS.tweetText, (candidate) => !isInsideAny(candidate, quotes));
  // The FIRST outer tweetText, never a concatenation: a quote tweet with no
  // commentary of its own must yield empty text, not the quoted author's words.
  const segments = textRoot === null ? [] : readSegments(textRoot);
  const quoteRoot = quotes[0];
  const record: TweetRecord = {
    tweetId,
    canonicalUrl,
    username,
    // As in v0.1: a rendered header without a readable name shows the handle.
    authorName: author.authorName ?? (author.hasHeader ? username : null),
    avatarUrl: author.avatarUrl,
    verified: author.verified,
    postedAt: readTime(anchor?.querySelector(X_SELECTORS.time) ?? null),
    text: segmentsToText(segments),
    segments,
    media: readMedia(root, quotes),
    quote: quoteRoot === undefined ? null : readQuote(quoteRoot),
    card: readCard(root, quotes),
    truncated: findWhere(root, X_SELECTORS.showMore, (candidate) => !isInsideAny(candidate, quotes)) !== null,
    capturedAt: context.now,
    updatedAt: context.now,
  };
  return { status: 'ok', record };
}
