import type { LinkCard, MediaItem } from '@/core/domain/tweet';
import { findWhere, isInsideAny, readVisibleText } from '@/utils/dom';
import { isAllowedImageUrl } from '@/utils/url';
import { firstAllowedImage, pictureIn } from './extractPicture';
import { X_SELECTORS } from './selectors';

const MEDIA_MAX = 4;
const GIF_POSTER = '/tweet_video_thumb/';
const TITLE_MAX = 300;
/** A line that is a bare domain, optionally after one word ("来自 example.com", "From example.com"). */
const DOMAIN_LINE = /^(?:\S+\s+)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/i;

function mediaFrom(cell: Element): MediaItem | null {
  const video = cell.querySelector(X_SELECTORS.video);
  if (video !== null) {
    const attribute = video.getAttribute('poster');
    const poster = attribute !== null && isAllowedImageUrl(attribute) ? attribute : pictureIn(cell);
    if (poster === null) return null;
    return { kind: poster.includes(GIF_POSTER) ? 'gif' : 'video', url: poster, alt: null };
  }
  const img = firstAllowedImage(cell);
  if (img === null) return null;
  return { kind: 'photo', url: img.src, alt: img.getAttribute('alt') };
}

/**
 * The post's pictures and video posters in page order. Each tweetPhoto cell is
 * one item: a cell holding a <video> is a video — or a GIF, by its poster
 * path — and anything else a photo. Cells inside `exclude` (the quote) are not
 * the post's own; a cell whose picture has not loaded yet is skipped.
 */
export function readMedia(scope: Element, exclude: readonly Element[]): MediaItem[] {
  const items: MediaItem[] = [];
  for (const cell of Array.from(scope.querySelectorAll(X_SELECTORS.mediaCell))) {
    if (isInsideAny(cell, exclude)) continue;
    const item = mediaFrom(cell);
    if (item !== null) items.push(item);
    if (items.length === MEDIA_MAX) break;
  }
  return items;
}

/** Non-empty text of every leaf span, in page order. */
function leafTexts(scope: Element): string[] {
  const out: string[] = [];
  for (const span of Array.from(scope.querySelectorAll(X_SELECTORS.textRun))) {
    if (span.querySelector(X_SELECTORS.textRun) !== null) continue;
    const text = readVisibleText(span).trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

/**
 * The post's link preview. The layout comes from X's test ids; the domain is
 * the first text line shaped like a bare domain and the title the first other
 * line. Reading the shape of the text rather than its wording keeps this
 * independent of X's interface language.
 */
export function readCard(scope: Element, exclude: readonly Element[]): LinkCard | null {
  const card = findWhere(scope, X_SELECTORS.card, (candidate) => !isInsideAny(candidate, exclude));
  if (card === null) return null;
  const anchor = card.querySelector(X_SELECTORS.anyLink);
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  let domain: string | null = null;
  let title: string | null = null;
  for (const line of leafTexts(card)) {
    const found = DOMAIN_LINE.exec(line)?.[1];
    if (found !== undefined) domain ??= found.toLowerCase();
    else title ??= line.slice(0, TITLE_MAX);
  }
  return {
    url: anchor.href,
    layout: card.querySelector(X_SELECTORS.cardSmallMedia) !== null ? 'small' : 'large',
    title,
    domain,
    imageUrl: pictureIn(card),
  };
}
