import { afterEach, describe, expect, it, vi } from 'vitest';

const counter = vi.hoisted(() => ({ extractions: 0 }));

vi.mock('@/hosts/x/TweetExtractor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hosts/x/TweetExtractor')>();
  return {
    ...actual,
    extractTweet: (...args: Parameters<typeof actual.extractTweet>) => {
      counter.extractions += 1;
      return actual.extractTweet(...args);
    },
  };
});

import { XRuntime } from '@/hosts/x/XRuntime';
import { loadFixture } from '../helpers/fixtures';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('XRuntime scanning', () => {
  let runtime: XRuntime | undefined;

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    counter.extractions = 0;
  });

  it('does not re-extract every post when X changes unrelated parts of the page', async () => {
    loadFixture('x-home');
    runtime = new XRuntime();
    runtime.start();
    await sleep(300); // the start-up scan drains in idle slices
    const afterStart = counter.extractions;
    expect(afterStart).toBeGreaterThan(0);

    const nav = document.querySelector('header[role="banner"] nav');
    expect(nav).not.toBeNull();
    // Stays under the 2s health tick, so only the root observer can react.
    for (let i = 0; i < 8; i += 1) {
      nav?.appendChild(document.createElement('div'));
      await sleep(150); // past the 120ms root debounce every time
    }
    await sleep(200);

    expect(counter.extractions).toBe(afterStart);
  });

  // Passes before and after the change: it guards the one case the removed
  // full scan used to cover — X swapping in a whole new primary column.
  it('scans a replacement primary column once when X swaps it in', async () => {
    loadFixture('x-home');
    runtime = new XRuntime();
    runtime.start();
    await sleep(300);

    const column = document.querySelector('[data-testid="primaryColumn"]');
    expect(column).not.toBeNull();
    const replacement = column?.cloneNode(true) as HTMLElement;
    replacement.querySelectorAll('[data-xf-action-host]').forEach((host) => host.remove());
    column?.replaceWith(replacement);
    await sleep(500);

    const tweets = Array.from(
      replacement.querySelectorAll('article[data-testid="tweet"]:not([data-xf-skip])'),
    );
    expect(tweets.length).toBeGreaterThan(0);
    for (const tweet of tweets) {
      expect(tweet.querySelectorAll('[data-xf-action-host]')).toHaveLength(1);
    }
  });
});
