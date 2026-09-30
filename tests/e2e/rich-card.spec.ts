import type { Locator, Page } from '@playwright/test';
import { expect, test } from './harness';

const RICH = '/home?fixture=home-rich';
/** The long post x-status-long.html was captured from (Task 14): cut short on the home sample, whole on its page. */
const LONG_POST = '1000000000000000006';

async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.locator('[data-xf-action-host]').count(), { timeout: 3_000 }).toBeGreaterThan(0);
}

async function createFolder(page: Page, name: string): Promise<void> {
  const sidebar = page.locator('[data-xf-sidebar-host]');
  await sidebar.getByRole('button', { name: '新建文件夹' }).click();
  const input = sidebar.getByPlaceholder('文件夹名称');
  await input.fill(name);
  await input.press('Enter');
  await expect(sidebar.getByRole('button', { name, exact: true })).toBeVisible();
}

/** The id of the first post whose article contains `selector`. */
async function postWith(page: Page, selector: string, options: { ownOnly?: boolean } = {}): Promise<string> {
  // ownOnly: the post itself has it, not merely the post it quotes.
  const noQuote = options.ownOnly === true ? ':not(:has(div[role="link"][tabindex="0"]))' : '';
  const host = page.locator(`article[data-testid="tweet"]:has(${selector})${noQuote} [data-xf-action-host]`).first();
  await expect(host).toHaveCount(1);
  const id = await host.getAttribute('data-xf-tweet-id');
  if (id === null) throw new Error(`no post with ${selector}`);
  return id;
}

async function saveInto(page: Page, tweetId: string, folder: string): Promise<void> {
  await page.locator(`[data-xf-action-host][data-xf-tweet-id="${tweetId}"] button`).click();
  const popover = page.locator('[data-xf-popover-host]');
  await popover.getByRole('menuitemcheckbox', { name: folder, exact: true }).first().click();
  await expect(popover).toHaveCount(0);
}

async function openFolder(page: Page, folder: string): Promise<Locator> {
  await page.locator('[data-xf-sidebar-host]').getByRole('button', { name: folder, exact: true }).click();
  return page.locator('[data-xf-overlay-host]');
}

test('a saved post with pictures shows as a rich card on the page and in the side panel', async ({
  harness,
}, testInfo) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, '图片');
  const id = await postWith(page, '[data-testid="tweetPhoto"] img', { ownOnly: true });
  await saveInto(page, id, '图片');

  const overlay = await openFolder(page, '图片');
  const row = overlay.locator(`[data-xf-tweet-id="${id}"]`);
  await expect(row.locator('.xf-tc-media-cell')).not.toHaveCount(0);
  await expect(row.locator('img.xf-tc-avatar')).toHaveCount(1);
  await expect(row.locator('.xf-tc-name')).not.toHaveText('');
  await expect(row.locator('.xf-tc-saved')).toHaveText(/^保存于 /);
  await page.screenshot({ path: testInfo.outputPath('rich-card-page.png') });

  const panel = await harness.context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${harness.extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: '图片', exact: true }).click();
  await expect(panel.locator(`[data-xf-tweet-id="${id}"] .xf-tc-media-cell`)).not.toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath('rich-card-panel.png') });
});

test('a post saved cut short is completed once its own page has been seen', async ({ harness }) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, '长帖');
  await saveInto(page, LONG_POST, '长帖');
  const overlay = await openFolder(page, '长帖');
  await expect(overlay.locator(`[data-xf-tweet-id="${LONG_POST}"] .xf-tc-more`)).toHaveCount(1);

  // The post's own page shows the whole text: once its saved count arrives,
  // the refresher sends the fuller capture and the background merges it.
  const detail = await harness.openX(`/user1/status/${LONG_POST}?fixture=status-long`);
  await ready(detail);

  await expect
    .poll(
      async () => {
        await page.reload();
        const again = await openFolder(page, '长帖');
        return again.locator(`[data-xf-tweet-id="${LONG_POST}"] .xf-tc-more`).count();
      },
      { timeout: 10_000 },
    )
    .toBe(0);
});

test('clicking a card opens the post; ⌘/Ctrl-click opens it in a new tab', async ({ harness }) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, 'A');
  const id = await postWith(page, '[data-testid="tweetText"]');
  await saveInto(page, id, 'A');
  const overlay = await openFolder(page, 'A');
  const saved = overlay.locator(`[data-xf-tweet-id="${id}"] .xf-tc-saved`);

  const [popup] = await Promise.all([
    harness.context.waitForEvent('page'),
    saved.click({ modifiers: ['ControlOrMeta'] }),
  ]);
  await expect.poll(() => popup.url()).toContain(`/status/${id}`);
  await popup.close();

  await Promise.all([page.waitForURL(new RegExp(`/status/${id}`)), saved.click()]);
});

test('the ⋯ menu removes a post from the folder', async ({ harness }) => {
  const page = await harness.openX(RICH);
  await ready(page);
  await createFolder(page, 'B');
  const id = await postWith(page, '[data-testid="tweetText"]');
  await saveInto(page, id, 'B');
  const overlay = await openFolder(page, 'B');

  await overlay.locator(`[data-xf-tweet-id="${id}"]`).getByRole('button', { name: '更多操作' }).click();
  await overlay.getByRole('menuitem', { name: '从此文件夹移除' }).click();
  await expect(overlay.locator(`[data-xf-tweet-id="${id}"]`)).toHaveCount(0);
  await expect(overlay.locator('.xf-fv-count')).toHaveText('0 条收藏');
});

test('every post on the bookmarks page gets exactly one folder button', async ({ harness }) => {
  const page = await harness.openX('/i/bookmarks');
  await ready(page);
  const extractable = page.locator('article[data-testid="tweet"]:not([data-xf-skip])');
  await expect
    .poll(async () => (await page.locator('[data-xf-action-host]').count()) === (await extractable.count()))
    .toBe(true);
  const perPost = await extractable.evaluateAll((posts) =>
    posts.map((post) => post.querySelectorAll('[data-xf-action-host]').length),
  );
  expect(perPost.every((count) => count === 1)).toBe(true);
});
