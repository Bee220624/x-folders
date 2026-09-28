import type { TweetId } from '@/core/domain/tweet';
import { rpc } from '@/messaging/RpcClient';
import { FolderStore } from '@/state/FolderStore';
import { VisibleTweetStore } from '@/state/VisibleTweetStore';
import { toasts } from '@/ui/shared/toastStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';
import { singleFlight } from '@/utils/singleFlight';
import { FolderViewMount } from './FolderViewMount';
import { HealthMonitor } from './HealthMonitor';
import { MutationBatcher } from './MutationBatcher';
import { listenForNavigateRequests } from './NavigateHandler';
import { RouteObserver } from './RouteObserver';
import { SavePopoverController } from './SavePopoverController';
import { SidebarMount } from './SidebarMount';
import { ThemeAdapter } from './ThemeAdapter';
import { TweetActionInjector } from './TweetActionInjector';
import { collectTweetRoots, scanTweetRoots } from './TweetDetector';
import { TweetEnhancer, tweetsMissingButton } from './TweetEnhancer';
import { X_SELECTORS } from './selectors';

const log = createLogger('runtime');

/** Debounce for the coarse root-lifecycle observer. */
const ROOT_DEBOUNCE_MS = 120;

/**
 * Owns every long-lived object in the content script and the wiring between
 * them. Nothing here talks to Dexie: all persistence goes through RPC.
 *
 * The observers are deliberately split into three, with different scopes and
 * different costs:
 *   - root lifecycle: coarse, debounced, only asks "did X replace a big node?"
 *   - tweet stream:   high volume, batched per frame, drained on idle slices
 *   - theme:          a narrow attribute filter on <html>/<body>
 * A single all-purpose observer would force the cheapest question to pay the
 * price of the most expensive one on every timeline update.
 */
export class XRuntime {
  readonly #registry = new CleanupRegistry();
  readonly #theme = new ThemeAdapter();
  readonly #store = new FolderStore();
  readonly #counts = new VisibleTweetStore();

  readonly #injector: TweetActionInjector;
  readonly #enhancer: TweetEnhancer;
  readonly #sidebar: SidebarMount;
  readonly #popover: SavePopoverController;
  readonly #folderView: FolderViewMount;
  readonly #route: RouteObserver;
  readonly #health: HealthMonitor;

  #rootObserver: MutationObserver | null = null;
  #streamBatcher: MutationBatcher | null = null;
  #streamTarget: Node | null = null;
  #rootDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly #reinitialize = singleFlight(() => this.#ensureAll());

  constructor() {
    this.#injector = new TweetActionInjector((tweetId, anchor) => {
      this.#popover.open(tweetId, anchor);
    });
    this.#enhancer = new TweetEnhancer(this.#injector, this.#counts, this.#registry);

    this.#sidebar = new SidebarMount({
      store: this.#store,
      theme: this.#theme,
      registry: this.#registry,
      onOpenFolder: (folderId) => this.#folderView.open(folderId),
    });

    this.#popover = new SavePopoverController({
      store: this.#store,
      theme: this.#theme,
      registry: this.#registry,
      resolveTweet: (tweetId) => this.#enhancer.recordFor(tweetId),
      onMembershipChanged: (tweetId, count) => this.#applyCount(tweetId, count),
    });

    this.#folderView = new FolderViewMount({
      store: this.#store,
      theme: this.#theme,
      registry: this.#registry,
      onMembershipChanged: (tweetId, count) => this.#applyCount(tweetId, count),
    });

    this.#route = new RouteObserver({
      registry: this.#registry,
      onEnsure: () => void this.#reinitialize(),
      onRouteChange: () => {
        // Leaving the route the overlay was opened from closes it, but the
        // stores keep their data: a navigation is not a reason to refetch.
        this.#folderView.close();
        this.#popover.close();
      },
    });

    this.#health = new HealthMonitor(
      {
        ensureSidebar: () => this.#sidebar.ensure(),
        ensureFolderView: () => this.#folderView.ensure(),
        ensurePopover: () => this.#popover.ensure(),
        ensureTweetButtons: () => {
          this.#enhancer.enqueue(tweetsMissingButton(document));
          // Same tick, same bounded DOM walk: evict state for rows the
          // virtualiser has already unmounted.
          this.#enhancer.prune(document);
        },
      },
      this.#registry,
    );
  }

  start(): void {
    this.#theme.attach(this.#registry);
    this.#store.attach(this.#registry);
    this.#counts.attach(this.#registry);

    this.#counts.subscribe(() => this.#enhancer.refreshButtons());
    this.#registry.add(() => toasts.reset());

    this.#observeRoot();
    this.#observeTweetStream();
    this.#route.start();
    this.#health.start();
    listenForNavigateRequests(this.#registry);

    void this.#store.refresh();
    void this.#reinitialize();
    log.debug('runtime started');
  }

  /**
   * Full pass: every mounted tweet plus the chrome around them. Runs at
   * start-up and after route changes, when X re-renders the timeline wholesale.
   */
  async #ensureAll(): Promise<void> {
    if (this.#registry.disposed) return;
    this.#ensureChrome();
    this.#enhancer.enqueue(scanTweetRoots(document));
  }

  /**
   * Cheap pass for the root observer: re-mount what X may have replaced and
   * re-point the tweet stream observer. Tweets are deliberately not scanned
   * here — X's DOM changes constantly, and re-extracting every mounted tweet
   * after each burst is wasted work that competes with scrolling. New tweets
   * arrive through the stream observer; a replacement primary column is
   * scanned once, when the observer moves onto it.
   */
  #ensureChrome(): void {
    if (this.#registry.disposed) return;
    this.#sidebar.ensure();
    this.#folderView.ensure();
    this.#popover.ensure();
    this.#retargetTweetStream();
  }

  #observeRoot(): void {
    const target = document.querySelector(X_SELECTORS.reactRoot) ?? document.body;
    const observer = new MutationObserver(() => {
      // Debounced and cheap: this callback only schedules, it never rebuilds UI
      // inline. X replaces large subtrees often enough that doing real work here
      // would mean rebuilding the sidebar several times per second.
      if (this.#rootDebounce !== null) clearTimeout(this.#rootDebounce);
      this.#rootDebounce = setTimeout(() => {
        this.#rootDebounce = null;
        this.#route.check();
        this.#ensureChrome();
      }, ROOT_DEBOUNCE_MS);
    });
    observer.observe(target, { childList: true, subtree: true });
    this.#rootObserver = observer;
    this.#registry.addObserver(observer);
    // Registered ONCE, not per fire. This observer runs continuously while the
    // timeline scrolls; registering the replacement timer each time would grow
    // the registry by one dead closure per mutation batch for the life of the
    // tab. Only the currently pending timer can ever need cancelling.
    this.#registry.add(() => {
      if (this.#rootDebounce !== null) clearTimeout(this.#rootDebounce);
      this.#rootDebounce = null;
    });
  }

  #observeTweetStream(): void {
    this.#streamBatcher = new MutationBatcher({
      registry: this.#registry,
      onFlush: (records) => {
        this.#enhancer.enqueue(collectTweetRoots(records));
        // Piggy-backing the URL check here means the 500ms poll is almost never
        // the thing that first notices a navigation.
        this.#route.check();
      },
    });
    this.#retargetTweetStream();
  }

  /** Re-points the stream observer when X swaps the primary column out. */
  #retargetTweetStream(): void {
    const target = document.querySelector(X_SELECTORS.primaryColumn) ?? document.body;
    if (target === this.#streamTarget || this.#streamBatcher === null) return;
    const replaced = this.#streamTarget !== null;
    this.#streamTarget = target;
    this.#streamBatcher.observe(target, { childList: true, subtree: true });
    // Tweets X rendered into the new column before we were watching it never
    // produced a mutation record we could see.
    if (replaced) this.#enhancer.enqueue(scanTweetRoots(target));
    log.debug('tweet stream observer retargeted');
  }

  #applyCount(tweetId: TweetId, count: number): void {
    this.#counts.setLocal(tweetId, count);
    this.#enhancer.refreshButtons();
  }

  /** Confirms the background is reachable; surfaces one toast if it is not. */
  async ping(): Promise<boolean> {
    const result = await rpc('health.ping', undefined);
    if (!result.ok) {
      toasts.show('扩展后台不可用，请刷新页面。', { tone: 'danger' });
      return false;
    }
    return true;
  }

  dispose(): void {
    this.#rootObserver?.disconnect();
    this.#streamBatcher?.disconnect();
    this.#sidebar.dispose();
    this.#popover.dispose();
    this.#folderView.dispose();
    TweetActionInjector.removeAll(document);
    this.#registry.dispose();
    log.debug('runtime disposed');
  }
}
