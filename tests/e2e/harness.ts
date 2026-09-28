import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';

/** The Playwright build: same code, shadow roots open (see src/ui/shared/shadowMode.ts). */
const EXTENSION_DIR = resolve(process.cwd(), 'dist/chrome-mv3-e2e');
const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures');

/** Which captured page answers an x.com path. */
function fixtureFor(pathname: string): string {
  if (/^\/[^/]+\/status\/\d+/.test(pathname)) return 'x-status.html';
  if (pathname.startsWith('/search')) return 'x-search.html';
  if (pathname === '/home' || pathname === '/') return 'x-home.html';
  return 'x-profile.html';
}

export interface Harness {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  openX(path?: string): Promise<Page>;
}

export const test = base.extend<{ harness: Harness }>({
  // Playwright reads fixture dependencies from this destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  harness: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });

    // Nothing leaves the machine: every other host is refused, and x.com is
    // answered from the captured fixtures. Later routes win, so the x.com
    // route is registered last.
    await context.route(/^https?:\/\/(?!x\.com\/)/, (route) => route.abort());
    await context.route('https://x.com/**', async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'document') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      const { pathname } = new URL(request.url());
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: readFileSync(resolve(FIXTURE_DIR, fixtureFor(pathname)), 'utf8'),
      });
    });

    // The fixtures keep X's DOM but none of its CSS, so the navigation column
    // would just grow with its content (1891px unstyled) and the sidebar budget
    // would see no room at all. Give it X's real shape instead — a scrolling
    // flex column filling the viewport below its top edge, with the 66px
    // account block at the bottom (measured on real X, 2026-09-29) — before
    // the content script mounts at document_idle.
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const nav = document.querySelector('header[role="banner"] nav');
        const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        if (nav === null || switcher === null) return;
        // On real X the navigation sits inside a z-index 0 stacking context, so
        // nothing mounted in it can rise above our page-level overlay.
        const banner = nav.closest('header[role="banner"]');
        if (banner instanceof HTMLElement) Object.assign(banner.style, { position: 'relative', zIndex: '0' });
        let column: Element | null = nav;
        while (column !== null && !column.contains(switcher)) column = column.parentElement;
        if (!(column instanceof HTMLElement)) return;
        const height = innerHeight - column.getBoundingClientRect().top;
        Object.assign(column.style, {
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        });
        for (const child of Array.from(column.children)) {
          if (!(child instanceof HTMLElement)) continue;
          Object.assign(child.style, {
            flex: 'none',
            overflow: 'hidden',
            height: child.contains(switcher) ? '66px' : '420px',
          });
        }
      });
    });

    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const openX = async (path = '/home'): Promise<Page> => {
      const page = await context.newPage();
      await page.goto(`https://x.com${path}`);
      return page;
    };

    await use({ context, extensionId, worker, openX });
    await context.close();
  },
});

export { expect } from '@playwright/test';
