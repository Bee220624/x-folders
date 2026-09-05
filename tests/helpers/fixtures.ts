import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X_SELECTORS } from '@/hosts/x/selectors';

export type FixtureName = 'x-home' | 'x-status' | 'x-profile' | 'x-search';

/**
 * Resolved from the process cwd rather than `import.meta.url`: under the jsdom
 * environment `import.meta.url` is rewritten to the emulated page URL, so a
 * relative resolve lands on `/tests/...` instead of the repo.
 */
function fixturePath(name: FixtureName): string {
  return resolve(process.cwd(), 'tests/fixtures', `${name}.html`);
}

/** Loads a captured X page into the jsdom document and returns its tweet roots. */
export function loadFixture(name: FixtureName): {
  document: Document;
  tweets: HTMLElement[];
} {
  const html = readFileSync(fixturePath(name), 'utf8');
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const bodyHtml = bodyMatch?.[1] ?? '';
  document.documentElement.innerHTML = `<head></head><body>${bodyHtml}</body>`;

  const bodyBg = /<body style="background-color: ([^"]+);"/.exec(html)?.[1];
  if (bodyBg !== undefined) document.body.style.backgroundColor = bodyBg;

  return {
    document,
    tweets: Array.from(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot)),
  };
}
