import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CleanupRegistry } from '@/utils/cleanup';
import { singleFlight } from '@/utils/singleFlight';
import { MutationBatcher } from '@/hosts/x/MutationBatcher';
import { collectTweetRoots, scanTweetRoots } from '@/hosts/x/TweetDetector';
import { RouteObserver, ENSURE_DELAYS_MS } from '@/hosts/x/RouteObserver';
import { HealthMonitor } from '@/hosts/x/HealthMonitor';
import { XRuntime } from '@/hosts/x/XRuntime';
import { loadFixture } from '../helpers/fixtures';

describe('CleanupRegistry', () => {
  it('runs every disposer once, in reverse order, and is idempotent', () => {
    const registry = new CleanupRegistry();
    const order: string[] = [];
    registry.add(() => order.push('first'));
    registry.add(() => order.push('second'));

    registry.dispose();
    registry.dispose();
    expect(order).toEqual(['second', 'first']);
    expect(registry.disposed).toBe(true);
  });

  it('does not let one failing disposer strand the others', () => {
    const registry = new CleanupRegistry();
    const ran: string[] = [];
    registry.add(() => ran.push('a'));
    registry.add(() => {
      throw new Error('boom');
    });
    registry.add(() => ran.push('c'));
    expect(() => registry.dispose()).not.toThrow();
    expect(ran).toEqual(['c', 'a']);
  });

  it('returns a handle that runs the cleanup early and only once', () => {
    const registry = new CleanupRegistry();
    const disposer = vi.fn();
    const handle = registry.add(disposer);

    handle();
    expect(disposer).toHaveBeenCalledOnce();
    handle();
    expect(disposer).toHaveBeenCalledOnce();
    // Already run and de-registered, so the registry must not run it again.
    registry.dispose();
    expect(disposer).toHaveBeenCalledOnce();
  });

  it('detaches a listener when its handle is called before disposal', () => {
    const registry = new CleanupRegistry();
    const handler = vi.fn();
    const detach = registry.addEventListener(document, 'click', handler);

    document.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledOnce();

    // The handle must actually remove the listener, not merely forget about it.
    detach();
    document.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledOnce();
    registry.dispose();
  });

  it('runs a disposer immediately if registered after disposal', () => {
    const registry = new CleanupRegistry();
    registry.dispose();
    const late = vi.fn();
    registry.add(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it('removes event listeners it registered', () => {
    const registry = new CleanupRegistry();
    const handler = vi.fn();
    registry.addEventListener(document, 'click', handler);
    document.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledOnce();

    registry.dispose();
    document.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('singleFlight', () => {
  it('recovers after the run rejects instead of wedging forever', async () => {
    let runs = 0;
    const guarded = singleFlight(async () => {
      runs += 1;
      if (runs === 1) throw new Error('boom');
    });

    await expect(guarded()).rejects.toThrow('boom');
    // Without a finally, `active` would still hold the rejected promise and
    // every later call would return it without ever invoking run() again —
    // which would permanently disable the runtime's reinitialize path.
    await guarded();
    await guarded();
    expect(runs).toBe(3);
  });

  it('collapses overlapping calls into one run plus one re-run', async () => {
    let running = 0;
    let peak = 0;
    let runs = 0;
    const guarded = singleFlight(async () => {
      running += 1;
      runs += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    });

    await Promise.all([guarded(), guarded(), guarded(), guarded()]);
    // Never concurrent, and the pile-up becomes exactly one extra pass.
    expect(peak).toBe(1);
    expect(runs).toBe(2);
  });
});

describe('registry growth under long-lived use', () => {
  let registry: CleanupRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new CleanupRegistry();
    history.pushState({}, '', '/home');
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  it('RouteObserver does not accumulate a disposer per navigation', () => {
    const added = vi.spyOn(CleanupRegistry.prototype, 'add');
    const observer = new RouteObserver({
      registry,
      onEnsure: () => {},
      onRouteChange: () => {},
    });
    observer.start();
    const baseline = added.mock.calls.length;

    for (let i = 0; i < 50; i += 1) {
      history.pushState({}, '', `/route-${i}`);
      observer.check();
      vi.advanceTimersByTime(1200);
    }

    // Three ensure passes per navigation are registered, but each must be taken
    // back off when it fires or is superseded. Unbounded growth here means a
    // dead closure per pass for the life of the tab.
    const net = added.mock.calls.length - baseline;
    expect(net).toBeGreaterThan(50); // registrations really did happen
    expect(registry.size).toBeLessThan(10); // ...and were taken back off
    added.mockRestore();
  });

  it('XRuntime does not accumulate a disposer per root mutation batch', async () => {
    vi.useRealTimers();
    document.body.innerHTML = '<div id="react-root"><div></div></div>';
    const added = vi.spyOn(CleanupRegistry.prototype, 'add');
    const runtime = new XRuntime();
    runtime.start();
    const afterStart = added.mock.calls.length;

    const root = document.getElementById('react-root');
    expect(root).not.toBeNull();
    for (let i = 0; i < 200; i += 1) {
      root?.appendChild(document.createElement('div'));
      // Let the observer deliver this batch before queuing the next.
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The root observer fires continuously while X's timeline scrolls. One
    // registry entry per delivered batch would mean hundreds of thousands of
    // dead closures in a tab left open for an afternoon.
    const perBatch = added.mock.calls.length - afterStart;
    expect(perBatch).toBeLessThan(20);

    runtime.dispose();
    added.mockRestore();
    vi.useFakeTimers();
  });

  it('HealthMonitor does not accumulate a disposer per visibility cycle', () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const monitor = new HealthMonitor(
      {
        ensureSidebar: () => {},
        ensureFolderView: () => {},
        ensurePopover: () => {},
        ensureTweetButtons: () => {},
      },
      registry,
    );
    monitor.start();

    for (let i = 0; i < 30; i += 1) {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    }
    expect(monitor.running).toBe(true);
    expect(registry.size).toBeLessThan(10);
  });
});

describe('MutationBatcher', () => {
  let registry: CleanupRegistry;

  beforeEach(() => {
    registry = new CleanupRegistry();
    document.body.innerHTML = '<div id="target"></div>';
  });

  afterEach(() => registry.dispose());

  it('coalesces a burst of mutations into a single flush', async () => {
    const onFlush = vi.fn();
    const batcher = new MutationBatcher({ onFlush, registry });
    const target = document.getElementById('target')!;
    batcher.observe(target, { childList: true, subtree: true });

    for (let i = 0; i < 200; i += 1) {
      target.appendChild(document.createElement('div'));
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(onFlush).toHaveBeenCalledTimes(1);
    const records = onFlush.mock.calls[0]?.[0] as MutationRecord[];
    expect(records.length).toBeGreaterThan(0);
  });

  it('stops delivering after disconnect', async () => {
    const onFlush = vi.fn();
    const batcher = new MutationBatcher({ onFlush, registry });
    const target = document.getElementById('target')!;
    batcher.observe(target, { childList: true });
    batcher.disconnect();

    target.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onFlush).not.toHaveBeenCalled();
  });
});

describe('TweetDetector', () => {
  it('collects roots that are added, contain, or are inside a tweet', () => {
    const { tweets } = loadFixture('x-home');
    const [first, second] = tweets;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    const wrapper = document.createElement('div');
    const third = tweets[2];
    if (third !== undefined) wrapper.appendChild(third);
    document.body.appendChild(wrapper);

    const inner = second.querySelector('div');
    const records = [
      { type: 'childList', addedNodes: [first], target: document.body },
      { type: 'childList', addedNodes: [wrapper], target: document.body },
      { type: 'childList', addedNodes: inner === null ? [] : [inner], target: second },
    ] as unknown as MutationRecord[];

    const found = collectTweetRoots(records);
    expect(found.has(first)).toBe(true);
    expect(found.has(second)).toBe(true);
    if (third !== undefined) expect(found.has(third)).toBe(true);
  });

  it('deduplicates and drops nodes already detached', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets[0]!;
    const records = [
      { type: 'childList', addedNodes: [root], target: document.body },
      { type: 'childList', addedNodes: [root], target: document.body },
    ] as unknown as MutationRecord[];
    expect(collectTweetRoots(records).size).toBe(1);

    root.remove();
    expect(collectTweetRoots(records).size).toBe(0);
  });

  it('scans only connected roots', () => {
    const { tweets } = loadFixture('x-home');
    expect(scanTweetRoots(document).length).toBe(tweets.length);
  });
});

describe('RouteObserver', () => {
  let registry: CleanupRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new CleanupRegistry();
    history.pushState({}, '', '/home');
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  it('runs the staged ensure passes after a navigation', () => {
    const onEnsure = vi.fn();
    const onRouteChange = vi.fn();
    const observer = new RouteObserver({ registry, onEnsure, onRouteChange });
    observer.start();

    history.pushState({}, '', '/explore');
    observer.check();
    expect(onRouteChange).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(1000);
    expect(onEnsure).toHaveBeenCalledTimes(ENSURE_DELAYS_MS.length);
  });

  it('cancels pending passes belonging to the route it just left', () => {
    const onEnsure = vi.fn();
    const observer = new RouteObserver({
      registry,
      onEnsure,
      onRouteChange: () => {},
    });
    observer.start();

    history.pushState({}, '', '/a');
    observer.check();
    vi.advanceTimersByTime(10);
    const afterFirst = onEnsure.mock.calls.length;

    // Navigate again before the 250ms/1000ms passes of the first route fire.
    history.pushState({}, '', '/b');
    observer.check();
    vi.advanceTimersByTime(2000);

    // Exactly one full set of passes for the second route, not two overlapping.
    expect(onEnsure.mock.calls.length).toBe(afterFirst + ENSURE_DELAYS_MS.length);
  });

  it('survives 50 consecutive navigations without leaking timers', () => {
    const onEnsure = vi.fn();
    const observer = new RouteObserver({ registry, onEnsure, onRouteChange: () => {} });
    observer.start();

    for (let i = 0; i < 50; i += 1) {
      history.pushState({}, '', `/route-${i}`);
      observer.check();
      vi.advanceTimersByTime(1200);
    }
    expect(onEnsure).toHaveBeenCalledTimes(50 * ENSURE_DELAYS_MS.length);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // only the 500ms poll
  });

  it('ignores a check when the URL has not changed', () => {
    const onRouteChange = vi.fn();
    const observer = new RouteObserver({ registry, onEnsure: () => {}, onRouteChange });
    observer.start();
    observer.check();
    observer.check();
    expect(onRouteChange).not.toHaveBeenCalled();
  });
});

describe('HealthMonitor', () => {
  let registry: CleanupRegistry;
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new CleanupRegistry();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  function makeChecks() {
    return {
      ensureSidebar: vi.fn(),
      ensureFolderView: vi.fn(),
      ensurePopover: vi.fn(),
      ensureTweetButtons: vi.fn(),
    };
  }

  it('runs every check on a tick', () => {
    const checks = makeChecks();
    const monitor = new HealthMonitor(checks, registry);
    monitor.start();
    vi.advanceTimersByTime(2000);
    for (const check of Object.values(checks)) expect(check).toHaveBeenCalled();
  });

  it('pauses while the tab is hidden and catches up when it returns', () => {
    const checks = makeChecks();
    const monitor = new HealthMonitor(checks, registry);
    monitor.start();
    expect(monitor.running).toBe(true);

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(monitor.running).toBe(false);

    const before = checks.ensureSidebar.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(checks.ensureSidebar.mock.calls.length).toBe(before);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(monitor.running).toBe(true);
    // An immediate catch-up pass, not a wait for the next full tick.
    expect(checks.ensureSidebar.mock.calls.length).toBe(before + 1);
  });

  it('does not let a throwing check stop the monitor', () => {
    const checks = makeChecks();
    checks.ensureSidebar.mockImplementation(() => {
      throw new Error('boom');
    });
    const monitor = new HealthMonitor(checks, registry);
    monitor.start();
    expect(() => vi.advanceTimersByTime(4000)).not.toThrow();
    expect(monitor.running).toBe(true);
  });

  it('stops entirely on dispose', () => {
    const checks = makeChecks();
    new HealthMonitor(checks, registry).start();
    registry.dispose();
    const before = checks.ensureSidebar.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(checks.ensureSidebar.mock.calls.length).toBe(before);
  });
});
