import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TweetActionInjector } from '@/hosts/x/TweetActionInjector';
import { findActionGroup } from '@/hosts/x/ActionGroupLocator';
import { extractTweet } from '@/hosts/x/TweetExtractor';
import { X_SELECTORS, XF_ATTR } from '@/hosts/x/selectors';
import { loadFixture } from '../helpers/fixtures';

const HOST = `[${XF_ATTR.actionHost}]`;

// The host's shadow root is closed, so there is no querying into it from here;
// the button comes from the injector's own lookup.
function buttonOf(host: HTMLElement): HTMLButtonElement {
  const button = TweetActionInjector.buttonFor(host);
  if (!(button instanceof HTMLButtonElement)) throw new Error('button missing');
  return button;
}

describe('tweet action injection', () => {
  let clicks: string[];
  let injector: TweetActionInjector;

  beforeEach(() => {
    clicks = [];
    injector = new TweetActionInjector((tweetId) => clicks.push(tweetId));
  });

  it('gives every extractable tweet on the home timeline exactly one button', () => {
    const { tweets } = loadFixture('x-home');
    let injected = 0;
    for (const root of tweets) {
      const outcome = extractTweet(root, { pathname: '/home', now: 1 });
      if (outcome.status !== 'ok') continue;
      const result = injector.ensure(root, { tweetId: outcome.record.tweetId, savedCount: 0 });
      if (result !== null) injected += 1;
    }
    expect(injected).toBeGreaterThan(0);
    for (const root of tweets) {
      expect(root.querySelectorAll(HOST).length).toBeLessThanOrEqual(1);
    }
    expect(document.querySelectorAll(HOST)).toHaveLength(injected);
  });

  it('appends to the end of the action group when X shows no bookmark button', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0];
    expect(root).toBeDefined();
    if (root === undefined) return;

    const match = findActionGroup(root);
    expect(match).not.toBeNull();
    // Real home-timeline action bars carry no [data-testid="bookmark"], so this
    // is the normal path rather than a rare fallback.
    expect(match?.bookmarkSlot).toBeNull();

    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    const group = match!.group;
    expect(group.lastElementChild?.hasAttribute(XF_ATTR.actionHost)).toBe(true);
  });

  it('inserts directly after the bookmark slot on a status page', () => {
    const { tweets } = loadFixture('x-status');
    const root = tweets.find((candidate) => findActionGroup(candidate)?.bookmarkSlot != null);
    expect(root).toBeDefined();
    if (root === undefined) return;

    const match = findActionGroup(root)!;
    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    expect(match.bookmarkSlot?.nextElementSibling?.hasAttribute(XF_ATTR.actionHost)).toBe(true);
  });

  it('is idempotent across repeated ensure calls', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    for (let i = 0; i < 10; i += 1) {
      injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    }
    expect(root.querySelectorAll(HOST)).toHaveLength(1);
  });

  it('converges to one host if a duplicate appears', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    const first = injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    expect(first).not.toBeNull();
    // Simulate X cloning a subtree that already contained our host.
    first!.host.after(first!.host.cloneNode(true));
    expect(root.querySelectorAll(HOST)).toHaveLength(2);

    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    expect(root.querySelectorAll(HOST)).toHaveLength(1);
  });

  it('restores the button after X replaces the whole action bar', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    expect(root.querySelectorAll(HOST)).toHaveLength(1);

    const group = findActionGroup(root)!.group;
    const replacement = group.cloneNode(true) as HTMLElement;
    replacement.querySelectorAll(HOST).forEach((node) => node.remove());
    group.replaceWith(replacement);
    expect(root.querySelectorAll(HOST)).toHaveLength(0);

    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    expect(root.querySelectorAll(HOST)).toHaveLength(1);
  });

  it('rebuilds when a recycled node now carries a different tweet', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 3 });
    const before = root.querySelector<HTMLElement>(HOST)!;
    expect(buttonOf(before).getAttribute('data-saved')).toBe('true');

    injector.ensure(root, { tweetId: '1000000000000000009', savedCount: 0 });
    const after = root.querySelector<HTMLElement>(HOST)!;
    expect(root.querySelectorAll(HOST)).toHaveLength(1);
    expect(after.getAttribute(XF_ATTR.tweetId)).toBe('1000000000000000009');
    // The stale "saved" state must not survive the reuse.
    expect(buttonOf(after).getAttribute('data-saved')).toBe('false');
  });

  it('updates the icon and label in place when the saved count changes', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    const host = root.querySelector<HTMLElement>(HOST)!;
    expect(buttonOf(host).getAttribute('aria-label')).toBe('保存到文件夹');

    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 2 });
    expect(root.querySelector<HTMLElement>(HOST)).toBe(host);
    expect(buttonOf(host).getAttribute('aria-label')).toBe('已保存到 2 个文件夹');
    expect(buttonOf(host).querySelectorAll('svg')).toHaveLength(1);
  });

  it('does not let the click reach the tweet card or the native bookmark', () => {
    const { tweets } = loadFixture('x-status');
    const root = tweets.find((candidate) => findActionGroup(candidate)?.bookmarkSlot != null)!;
    const cardClicks = vi.fn();
    const bookmarkClicks = vi.fn();
    root.addEventListener('click', cardClicks);
    root.querySelector(X_SELECTORS.bookmark)?.addEventListener('click', bookmarkClicks);

    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    const host = root.querySelector<HTMLElement>(HOST)!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    buttonOf(host).dispatchEvent(event);

    expect(clicks).toEqual(['1000000000000000001']);
    expect(event.defaultPrevented).toBe(true);
    expect(cardClicks).not.toHaveBeenCalled();
    expect(bookmarkClicks).not.toHaveBeenCalled();
  });

  it('rebuilds a leftover host whose closed root this context cannot reach', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    const group = findActionGroup(root)!.group;

    // Exactly what an extension reload leaves behind in X's DOM: our markup and
    // our tweet id, over a closed root no live WeakMap has the button for.
    const leftover = document.createElement('div');
    leftover.setAttribute(XF_ATTR.actionHost, '');
    leftover.setAttribute(XF_ATTR.tweetId, '1000000000000000001');
    leftover.attachShadow({ mode: 'closed' }).appendChild(document.createElement('button'));
    group.appendChild(leftover);

    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 2 });

    expect(root.querySelectorAll(HOST)).toHaveLength(1);
    const host = root.querySelector<HTMLElement>(HOST)!;
    expect(host).not.toBe(leftover);
    expect(leftover.isConnected).toBe(false);
    // The replacement is a live button, not just fresh markup: state reaches it
    // and a click reaches our handler.
    expect(buttonOf(host).getAttribute('aria-label')).toBe('已保存到 2 个文件夹');
    buttonOf(host).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicks).toEqual(['1000000000000000001']);
  });

  it('keeps the button out of reach of a page script', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });

    // Everything a script on x.com can see of the host: the element, and
    // nothing whatsoever inside it.
    const host = document.querySelector<HTMLElement>(HOST)!;
    expect(host.shadowRoot).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toBe('');
  });

  it('removes every injected host on teardown', () => {
    const { tweets } = loadFixture('x-home');
    for (const root of tweets) {
      injector.ensure(root, { tweetId: '1000000000000000001', savedCount: 0 });
    }
    expect(document.querySelectorAll(HOST).length).toBeGreaterThan(0);
    TweetActionInjector.removeAll(document);
    expect(document.querySelectorAll(HOST)).toHaveLength(0);
  });
});
