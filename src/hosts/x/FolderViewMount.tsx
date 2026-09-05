import { render } from 'preact';
import type { FolderStore } from '@/state/FolderStore';
import { FolderViewApp } from '@/ui/folder-view/FolderViewApp';
import { FOLDER_VIEW_CSS } from '@/ui/folder-view/folderView.css';
import { createShadowHost, type ShadowHostHandle } from '@/ui/shared/ShadowHost';
import { BASE_CSS, FEEDBACK_CSS } from '@/ui/shared/theme.css';
import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';
import { locatePrimaryColumn } from './PrimaryColumnLocator';
import { X_SELECTORS, XF_ATTR } from './selectors';
import type { ThemeAdapter } from './ThemeAdapter';

const log = createLogger('folder-view-mount');

const HOST_SELECTOR = `[${XF_ATTR.overlayHost}]`;

export interface FolderViewDeps {
  store: FolderStore;
  theme: ThemeAdapter;
  registry: CleanupRegistry;
  /** Called after a removal so the tweet's action button icon refreshes. */
  onMembershipChanged: (tweetId: string, membershipCount: number) => void;
}

/**
 * The folder view: a shadow overlay covering X's primary column and nothing
 * else, so the left navigation and the right-hand column stay usable. X's own
 * DOM is never removed — it stays mounted underneath and is still there when
 * the view closes.
 */
export class FolderViewMount {
  #handle: ShadowHostHandle | null = null;
  #folderId: string | null = null;
  #column: HTMLElement | null = null;
  #stopObservers: (() => void) | null = null;

  constructor(private readonly deps: FolderViewDeps) {}

  isOpen(): boolean {
    return this.#handle !== null;
  }

  activeFolderId(): string | null {
    return this.#folderId;
  }

  open(folderId: string): void {
    this.#folderId = folderId;
    // Keeps the sidebar's highlighted row and the open view in agreement, no
    // matter which of the two initiated the change.
    this.deps.store.setActiveFolder(folderId);
    if (this.#handle === null) this.#handle = this.#createHost();
    this.#render(folderId);
    this.ensure();
    log.debug('opened', folderId);
  }

  close(): void {
    if (this.#handle === null && this.#folderId === null) return;
    this.#folderId = null;
    this.#teardown();
    this.deps.store.setActiveFolder(null);
  }

  /** Idempotent: re-aligns to the primary column, closes if the folder vanished. */
  ensure(): void {
    const folderId = this.#folderId;
    if (folderId === null) return;

    const { revision } = this.deps.store.state;
    // `revision > 0` means at least one real snapshot has been applied. Before
    // that, an unknown id only means the store has not loaded yet.
    if (revision > 0 && this.deps.store.findFolder(folderId) === undefined) {
      log.debug('folder gone, closing', folderId);
      this.close();
      return;
    }

    let handle = this.#handle;
    if (handle === null) {
      handle = this.#createHost();
      this.#handle = handle;
      this.#render(folderId);
    }

    // Converge on a single host: X can clone a subtree that already holds ours.
    for (const stray of Array.from(document.querySelectorAll<HTMLElement>(HOST_SELECTOR))) {
      if (stray !== handle.host) stray.remove();
    }
    if (!handle.isConnected()) this.#attach(handle.host);
    this.#align();
  }

  dispose(): void {
    this.#folderId = null;
    this.#teardown();
  }

  #createHost(): ShadowHostHandle {
    const handle = createShadowHost({
      marker: XF_ATTR.overlayHost,
      css: `${BASE_CSS}${FEEDBACK_CSS}${FOLDER_VIEW_CSS}`,
      theme: this.deps.theme,
      registry: this.deps.registry,
    });
    handle.host.style.position = 'fixed';
    // X renders every dialog, dropdown, media viewer and toast into #layers,
    // which sits at z-index 1. An overlay with a large z-index would paint over
    // all of them and leave X's own menus invisible while the folder view is
    // open. So: stay at the same modest level, and sit *before* #layers in the
    // document — equal z-index, earlier in tree order, X's layers still win.
    handle.host.style.zIndex = '1';
    this.#attach(handle.host);
    return handle;
  }

  #attach(host: HTMLElement): void {
    const layers = document.querySelector<HTMLElement>(X_SELECTORS.layers);
    const parent = layers === null ? null : layers.parentElement;
    if (layers !== null && parent !== null) parent.insertBefore(host, layers);
    else document.body.appendChild(host);
  }

  #render(folderId: string): void {
    const handle = this.#handle;
    if (handle === null) return;
    render(
      <FolderViewApp
        store={this.deps.store}
        folderId={folderId}
        onClose={() => this.close()}
        onMembershipChanged={this.deps.onMembershipChanged}
      />,
      handle.mount,
    );
  }

  /**
   * X scrolls the window, so the primary column's own rect spans the whole
   * timeline and its top goes negative mid-scroll. Only the horizontal extent
   * is taken from the column; vertically the overlay covers the part of the
   * viewport the column currently occupies.
   */
  #align(): void {
    const handle = this.#handle;
    if (handle === null) return;
    const anchor = locatePrimaryColumn();
    if (anchor === null) {
      // Transient during a route change; the watchdog calls ensure() again.
      log.debug('no primary column');
      return;
    }
    if (anchor.column !== this.#column) {
      this.#column = anchor.column;
      this.#observe(anchor.column);
    }

    const viewportHeight = document.defaultView?.innerHeight ?? 0;
    const top = Math.min(Math.max(anchor.rect.top, 0), viewportHeight);
    const style = handle.host.style;
    style.left = `${Math.round(anchor.rect.left)}px`;
    style.width = `${Math.round(anchor.rect.width)}px`;
    style.top = `${Math.round(top)}px`;
    style.height = `${Math.round(viewportHeight - top)}px`;
  }

  #observe(column: HTMLElement): void {
    this.#stopObservers?.();
    const onChange = (): void => this.#align();

    // `registry.add` hands back an *unregister*, not the disposer itself, so
    // closing the view has to stop each observer and drop it from the registry.
    const stops: Array<() => void> = [];
    window.addEventListener('resize', onChange);
    const unregisterResize = this.deps.registry.add(() =>
      window.removeEventListener('resize', onChange),
    );
    stops.push(() => {
      window.removeEventListener('resize', onChange);
      unregisterResize();
    });

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(onChange);
      observer.observe(column);
      // The documentElement too: X's layout shifts when the right-hand column
      // appears or a banner is dismissed, without the column itself resizing.
      observer.observe(document.documentElement);
      const unregisterObserver = this.deps.registry.addObserver(observer);
      stops.push(() => {
        observer.disconnect();
        unregisterObserver();
      });
    }

    this.#stopObservers = () => {
      for (const stop of stops) stop();
    };
  }

  #teardown(): void {
    this.#stopObservers?.();
    this.#stopObservers = null;
    this.#column = null;
    if (this.#handle === null) return;
    // Unmounting runs the app's effect cleanups, which invalidate any page
    // request still in flight.
    render(null, this.#handle.mount);
    this.#handle.dispose();
    this.#handle = null;
  }
}
