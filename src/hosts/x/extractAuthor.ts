import { findWhere, isInsideAny, readVisibleText } from '@/utils/dom';
import { pictureIn } from './extractPicture';
import { X_SELECTORS } from './selectors';

export interface AuthorParts {
  /** False while X has not rendered the header yet. */
  hasHeader: boolean;
  authorName: string | null;
  /** The visible @handle without "@". The permalink stays the post's identity. */
  handle: string | null;
  verified: boolean;
  avatarUrl: string | null;
}

const HANDLE = /^@([A-Za-z0-9_]{1,15})$/;
const NAME_MAX = 128;

/**
 * Reads one post header: the outer post (with its quote subtrees in
 * `exclude`) or a quote block (with nothing excluded).
 *
 * User-Name's leaf spans come in a fixed order — display name, "@handle", "·"
 * and the time — so the first non-handle text is the name. The check mark
 * sits inside User-Name, so a quoted author's mark is never the outer one's.
 */
export function readAuthor(scope: Element, exclude: readonly Element[]): AuthorParts {
  const userName = findWhere(scope, X_SELECTORS.userName, (candidate) => !isInsideAny(candidate, exclude));
  const avatar = findWhere(scope, X_SELECTORS.avatar, (candidate) => !isInsideAny(candidate, exclude));
  if (userName === null) {
    return { hasHeader: false, authorName: null, handle: null, verified: false, avatarUrl: pictureIn(avatar) };
  }

  let authorName: string | null = null;
  let handle: string | null = null;
  for (const span of Array.from(userName.querySelectorAll(X_SELECTORS.textRun))) {
    if (span.querySelector(X_SELECTORS.textRun) !== null) continue;
    if (span.closest(X_SELECTORS.time) !== null) continue;
    const text = readVisibleText(span).trim();
    if (text.length === 0 || text === '·') continue;
    const match = HANDLE.exec(text);
    if (match !== null) {
      handle ??= match[1] ?? null;
      continue;
    }
    if (text.startsWith('@')) continue;
    authorName ??= text.slice(0, NAME_MAX);
  }

  return {
    hasHeader: true,
    authorName,
    handle,
    verified: userName.querySelector(X_SELECTORS.verifiedBadge) !== null,
    avatarUrl: pictureIn(avatar),
  };
}
