import type { Page } from '@playwright/test';
import { expect, test } from './harness';

const HOST = '[data-xf-action-host]';

/** Creates a root folder from the sidebar, then saves the first post into it. */
async function saveFirstPostInto(page: Page, folderName: string): Promise<string> {
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await sidebar.getByRole('button', { name: '新建文件夹' }).click();
  const input = sidebar.getByPlaceholder('文件夹名称');
  await input.fill(folderName);
  await input.press('Enter');
  await expect(sidebar.getByRole('button', { name: folderName, exact: true })).toBeVisible();

  const host = page.locator(HOST).first();
  const tweetId = await host.getAttribute('data-xf-tweet-id');
  if (tweetId === null) throw new Error('action host without a tweet id');
  await host.locator('button').click();

  const popover = page.locator('[data-xf-popover-host]');
  await expect(popover).toHaveCount(1);
  await popover.getByRole('menuitemcheckbox', { name: folderName, exact: true }).first().click();
  await expect(popover).toHaveCount(0);
  await expect(host.locator('button')).toHaveAttribute('data-saved', 'true');
  return tweetId;
}

test('every extractable post gets exactly one folder button', async ({ harness }) => {
  const page = await harness.openX('/home');
  const extractable = page.locator('article[data-testid="tweet"]:not([data-xf-skip])');
  await expect.poll(() => page.locator(HOST).count(), { timeout: 2_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => (await page.locator(HOST).count()) === (await extractable.count()), {
      timeout: 2_000,
    })
    .toBe(true);
  const perPost = await extractable.evaluateAll((posts) =>
    posts.map((post) => post.querySelectorAll('[data-xf-action-host]').length),
  );
  expect(perPost.every((count) => count === 1)).toBe(true);
});

test('the folder tree mounts once and stays single', async ({ harness }) => {
  const page = await harness.openX('/home');
  await expect(page.locator('[data-xf-sidebar-host]')).toHaveCount(1, { timeout: 2_000 });
  await page.waitForTimeout(2_500); // at least one health tick
  await expect(page.locator('[data-xf-sidebar-host]')).toHaveCount(1);
});

test('a saved post shows in the page overlay and in the side panel', async ({ harness }) => {
  const page = await harness.openX('/home');
  const tweetId = await saveFirstPostInto(page, 'AI');

  await page.locator('[data-xf-sidebar-host]').getByRole('button', { name: 'AI', exact: true }).click();
  const overlay = page.locator('[data-xf-overlay-host]');
  await expect(overlay.locator(`[data-xf-tweet-id="${tweetId}"]`)).toHaveCount(1);
  await expect(overlay.getByRole('button', { name: '在侧边栏中打开' })).toBeVisible();

  // The real side panel is browser chrome Playwright cannot drive; the same
  // page opened in a tab exercises everything but the panel frame itself.
  const panel = await harness.context.newPage();
  await panel.goto(`chrome-extension://${harness.extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(panel.locator(`[data-xf-tweet-id="${tweetId}"]`)).toHaveCount(1);
});

test('clicking a post in the side panel opens it in a tab, not inside the panel', async ({ harness }) => {
  const page = await harness.openX('/home');
  const tweetId = await saveFirstPostInto(page, 'AI');
  const panel = await harness.context.newPage();
  await panel.goto(`chrome-extension://${harness.extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'AI', exact: true }).click();
  // openPost asks the *active* tab first; make that the panel page, which has
  // no content script, so the new-tab fallback is what gets exercised.
  await panel.bringToFront();

  const [opened] = await Promise.all([
    harness.context.waitForEvent('page'),
    panel.locator(`[data-xf-tweet-id="${tweetId}"] a`).first().click(),
  ]);
  await opened.waitForLoadState();
  // A tab the extension opens itself (chrome.tabs.create) escapes Playwright's
  // request routing, so it cannot load the fixture and lands on Chrome's
  // network error page. What this test is about is *which* URL the side panel
  // asked for, and the tab's navigation history records exactly that.
  const cdp = await harness.context.newCDPSession(opened);
  const history = await cdp.send('Page.getNavigationHistory');
  expect(history.entries[history.currentIndex]?.url).toMatch(
    new RegExp(`^https://x\\.com/[^/]+/status/${tweetId}$`),
  );
  expect(panel.url()).toContain('/sidepanel.html');
});

test('typing a folder name never reaches page-level shortcut listeners', async ({ harness }) => {
  await harness.context.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __xfSeenKeys: string[] }).__xfSeenKeys = seen;
    document.addEventListener('keydown', (event) => seen.push(event.key));
  });
  const page = await harness.openX('/home');
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await sidebar.getByRole('button', { name: '新建文件夹' }).click();
  await sidebar.getByPlaceholder('文件夹名称').pressSequentially('nrtljk');

  const seen = await page.evaluate(
    () => (window as unknown as { __xfSeenKeys: string[] }).__xfSeenKeys,
  );
  expect(seen).toEqual([]);
});

test('200 new posts all get a button without long tasks', async ({ harness }) => {
  const page = await harness.openX('/home');
  await expect(page.locator(HOST).first()).toBeAttached({ timeout: 3_000 });
  const before = await page.locator(HOST).count();

  await page.evaluate(() => {
    const store = window as unknown as { __xfLong: Array<{ start: number; duration: number }> };
    store.__xfLong = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.__xfLong.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask' });
  });

  const burstEnd = await page.evaluate(() => {
    const source = document
      .querySelector('article[data-testid="tweet"]:not([data-xf-skip])')
      ?.closest('[data-testid="cellInnerDiv"]');
    const parent = source?.parentElement;
    if (source === null || source === undefined || parent === null || parent === undefined) {
      throw new Error('timeline not found');
    }
    for (let i = 0; i < 200; i += 1) {
      const clone = source.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-xf-action-host]').forEach((host) => host.remove());
      const id = `9${String(i).padStart(18, '0')}`;
      clone.querySelectorAll('a[href*="/status/"]').forEach((anchor) => {
        const href = anchor.getAttribute('href') ?? '';
        anchor.setAttribute('href', href.replace(/\/status\/\d+/, `/status/${id}`));
      });
      parent.appendChild(clone);
    }
    // The cloning itself is one long task of ours; only what follows counts.
    return performance.now();
  });

  await expect
    .poll(() => page.locator(HOST).count(), { timeout: 5_000 })
    .toBe(before + 200);
  const longTasks = await page.evaluate(
    () => (window as unknown as { __xfLong: Array<{ start: number; duration: number }> }).__xfLong,
  );
  expect(longTasks.filter((task) => task.start >= burstEnd && task.duration > 50)).toEqual([]);
});
