import type { TextSegment } from '@/core/domain/tweet';
import { readVisibleText } from '@/utils/dom';

const X_HOSTS: ReadonlySet<string> = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);
const PROFILE_PATH = /^\/([A-Za-z0-9_]{1,15})$/;
const HASHTAG_PATH = /^\/hashtag\/([^/]+)$/;
const LEADING_SPACE = /^[\s\uFEFF\u00A0]+/;
const TRAILING_SPACE = /[\s\uFEFF\u00A0]+$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function anchorSegment(anchor: HTMLAnchorElement): TextSegment | null {
  const text = readVisibleText(anchor);
  if (text.length === 0) return null;
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return { kind: 'text', text };
  }
  if (X_HOSTS.has(url.hostname)) {
    const profile = PROFILE_PATH.exec(url.pathname)?.[1];
    if (profile !== undefined && text.startsWith('@')) return { kind: 'mention', text, username: profile };
    const hashtag = HASHTAG_PATH.exec(url.pathname)?.[1];
    if (hashtag !== undefined) return { kind: 'hashtag', text, tag: safeDecode(hashtag) };
  }
  return { kind: 'link', text, url: url.href };
}

/**
 * Turns a tweetText block into segments. Structure decides the kind, never the
 * wording or styling: an <a> to a profile whose text starts with "@" is a
 * mention, an <a> to /hashtag/… a hashtag, any other <a> a link (t.co, cashtag
 * searches), an <img> an emoji whose alt is the character, and <br> a newline.
 * The outer whitespace is trimmed; inner newlines stay.
 */
export function readSegments(textRoot: Element): TextSegment[] {
  const out: TextSegment[] = [];
  const pushText = (text: string): void => {
    if (text.length === 0) return;
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === 'text') last.text += text;
    else out.push({ kind: 'text', text });
  };

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'br') {
      pushText('\n');
      return;
    }
    if (tag === 'img') {
      const alt = element.getAttribute('alt');
      if (alt !== null && alt.length > 0) out.push({ kind: 'emoji', text: alt });
      return;
    }
    if (tag === 'script' || tag === 'style' || tag === 'svg') return;
    if (element instanceof HTMLAnchorElement) {
      const segment = anchorSegment(element);
      if (segment !== null) out.push(segment);
      return;
    }
    for (const child of Array.from(element.childNodes)) visit(child);
  };

  visit(textRoot);

  const first = out[0];
  if (first?.kind === 'text') first.text = first.text.replace(LEADING_SPACE, '');
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text = last.text.replace(TRAILING_SPACE, '');
  return out.filter((segment) => segment.text.length > 0);
}
