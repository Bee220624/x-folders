import { isAllowedImageUrl } from '@/utils/url';
import { X_SELECTORS } from './selectors';

const BACKGROUND_URL = /url\((['"]?)(.*?)\1\)/;

/** The first <img> in `scope` whose picture is on X's image server. */
export function firstAllowedImage(scope: Element): HTMLImageElement | null {
  for (const img of Array.from(scope.querySelectorAll<HTMLImageElement>(X_SELECTORS.image))) {
    if (isAllowedImageUrl(img.src)) return img;
  }
  return null;
}

/**
 * The first allowed picture in `scope`. X paints avatars and video posters
 * twice — as an <img> and as a CSS background — and either may still be
 * missing while the picture loads (a background tab has neither yet).
 */
export function pictureIn(scope: Element | null): string | null {
  if (scope === null) return null;
  const img = firstAllowedImage(scope);
  if (img !== null) return img.src;
  for (const element of Array.from(scope.querySelectorAll<HTMLElement>(X_SELECTORS.backgroundImage))) {
    const url = BACKGROUND_URL.exec(element.style.backgroundImage)?.[2];
    if (url !== undefined && isAllowedImageUrl(url)) return url;
  }
  return null;
}

/** Milliseconds from a `<time datetime>`, or null when it is missing or unparsable. */
export function readTime(time: Element | null): number | null {
  const value = time?.getAttribute('datetime') ?? null;
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
