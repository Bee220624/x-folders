import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TweetEnhancer, tweetsMissingButton } from '@/hosts/x/TweetEnhancer';
import { TweetActionInjector } from '@/hosts/x/TweetActionInjector';
import { VisibleTweetStore } from '@/state/VisibleTweetStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { XF_ATTR, X_SELECTORS } from '@/hosts/x/selectors';
import { loadFixture } from '../helpers/fixtures';

function makeEnhancer(): {
  enhancer: TweetEnhancer;
  registry: CleanupRegistry;
  clicks: string[];
  counts: VisibleTweetStore;
} {
  const registry = new CleanupRegistry();
  const clicks: string[] = [];
  const injector = new TweetActionInjector((tweetId) => clicks.push(tweetId));
  const counts = new VisibleTweetStore();
  counts.attach(registry);
  return { enhancer: new TweetEnhancer(injector, counts, registry), registry, clicks, counts };
}

describe('TweetEnhancer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does no work synchronously when a large batch is enqueued', () => {
    const { tweets } = loadFixture('x-home');
    const { enhancer } = makeEnhancer();

    // Fan the captured tweets out into a 200-node burst, as a fast scroll would.
    const burst: HTMLElement[] = [];
    const container = document.querySelector(X_SELECTORS.primaryColumn) ?? document.body;
    for (let i = 0; i < 200; i += 1) {
      const source = tweets[i % tweets.length];
      if (source === undefined) continue;
      const clone = source.cloneNode(true) as HTMLElement;
      container.appendChild(clone);
      burst.push(clone);
    }

    enhancer.enqueue(burst);
    // Nothing has been injected yet: the queue drains on idle slices.
    expect(document.querySelectorAll(`[${XF_ATTR.actionHost}]`)).toHaveLength(0);
    expect(enhancer.pending).toBe(burst.length);
  });

  it('respects the time budget and leaves the rest queued', () => {
    const { tweets } = loadFixture('x-home');
    const { enhancer } = makeEnhancer();
    const container = document.querySelector(X_SELECTORS.primaryColumn) ?? document.body;
    const burst: HTMLElement[] = [];
    for (let i = 0; i < 60; i += 1) {
      const source = tweets[i % tweets.length];
      if (source === undefined) continue;
      const clone = source.cloneNode(true) as HTMLElement;
      container.appendChild(clone);
      burst.push(clone);
    }
    enhancer.enqueue(burst);

    // A clock that jumps past the budget after the first node forces the slice
    // to yield, which is the behaviour that keeps scrolling smooth.
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 20;
      return now;
    });
    enhancer.drain(8);
    expect(enhancer.pending).toBeGreaterThan(0);
    expect(enhancer.pending).toBeLessThan(burst.length);
  });

  it('drains fully across repeated slices and injects one button per tweet', () => {
    loadFixture('x-home');
    const { enhancer } = makeEnhancer();
    const roots = Array.from(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot));
    enhancer.enqueue(roots);

    for (let i = 0; i < 50 && enhancer.pending > 0; i += 1) enhancer.drain(1000);
    expect(enhancer.pending).toBe(0);

    for (const root of roots) {
      expect(root.querySelectorAll(`[${XF_ATTR.actionHost}]`).length).toBeLessThanOrEqual(1);
    }
    expect(document.querySelectorAll(`[${XF_ATTR.actionHost}]`).length).toBeGreaterThan(0);
  });

  it('stamps permanently unextractable nodes and never re-queues them', () => {
    loadFixture('x-home');
    const { enhancer } = makeEnhancer();
    const roots = Array.from(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot));
    enhancer.enqueue(roots);
    for (let i = 0; i < 50 && enhancer.pending > 0; i += 1) enhancer.drain(1000);

    const skipped = document.querySelectorAll<HTMLElement>(`[${XF_ATTR.skip}]`);
    expect(skipped.length).toBeGreaterThan(0);
    for (const node of skipped) expect(node.getAttribute(XF_ATTR.skip)).toBe('promoted');

    // Re-enqueueing everything must not put the skipped nodes back in the queue.
    enhancer.enqueue(roots);
    expect(enhancer.pending).toBe(roots.length - skipped.length);
  });

  it('excludes skipped nodes from the watchdog scan', () => {
    loadFixture('x-home');
    const { enhancer } = makeEnhancer();
    const before = tweetsMissingButton(document).length;
    expect(before).toBeGreaterThan(0);

    enhancer.enqueue(Array.from(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot)));
    for (let i = 0; i < 50 && enhancer.pending > 0; i += 1) enhancer.drain(1000);

    // Everything is either injected or stamped, so the watchdog has nothing left
    // to rediscover every two seconds.
    expect(tweetsMissingButton(document)).toHaveLength(0);
  });

  it('remembers the extracted record so the popover can save it', () => {
    loadFixture('x-home');
    const { enhancer } = makeEnhancer();
    enhancer.enqueue(Array.from(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot)));
    for (let i = 0; i < 50 && enhancer.pending > 0; i += 1) enhancer.drain(1000);

    const host = document.querySelector<HTMLElement>(`[${XF_ATTR.actionHost}]`);
    expect(host).not.toBeNull();
    const tweetId = host?.getAttribute(XF_ATTR.tweetId);
    expect(tweetId).toBeTruthy();
    if (tweetId == null) return;
    const record = enhancer.recordFor(tweetId);
    expect(record?.tweetId).toBe(tweetId);
    expect(record?.canonicalUrl).toContain('https://x.com/');
  });

  it('evicts state for tweets the virtualiser has unmounted', () => {
    loadFixture('x-home');
    const { enhancer, counts } = makeEnhancer();
    const roots = Array.from(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot));
    enhancer.enqueue(roots);
    for (let i = 0; i < 50 && enhancer.pending > 0; i += 1) enhancer.drain(1000);

    const hosts = Array.from(document.querySelectorAll<HTMLElement>(`[${XF_ATTR.actionHost}]`));
    expect(hosts.length).toBeGreaterThan(1);
    const ids = hosts.map((host) => host.getAttribute(XF_ATTR.tweetId) ?? '');
    const survivor = ids[0];
    expect(survivor).toBeTruthy();
    if (survivor === undefined) return;
    for (const id of ids) {
      expect(enhancer.recordFor(id)).not.toBeNull();
      // Seed the count map as a real RPC round trip would.
      counts.setLocal(id, 1);
    }
    expect(counts.counts.size).toBe(ids.length);

    // X virtualises the timeline: scrolled-past rows are removed from the DOM.
    // Without pruning, BOTH maps keep growing — the record map holds each
    // tweet's full text, author and URL, and the count map one entry per row.
    const keptRoot = hosts[0]?.closest(X_SELECTORS.tweetRoot);
    for (const root of roots) {
      if (root !== keptRoot) root.remove();
    }
    enhancer.prune(document);

    expect(enhancer.recordFor(survivor)).not.toBeNull();
    for (const id of ids.slice(1)) expect(enhancer.recordFor(id)).toBeNull();
    expect(counts.counts.size).toBe(1);
    expect(counts.countFor(survivor)).toBe(1);
  });

  it('drops queued work on dispose', () => {
    loadFixture('x-home');
    const { enhancer, registry } = makeEnhancer();
    enhancer.enqueue(Array.from(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetRoot)));
    expect(enhancer.pending).toBeGreaterThan(0);
    registry.dispose();
    expect(enhancer.pending).toBe(0);
  });
});
