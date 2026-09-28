import { render } from 'preact';
import type { CleanupRegistry } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';
import { createShadowHost, dedupeHosts, type ShadowHostHandle } from '@/ui/shared/ShadowHost';
import { BASE_CSS, FEEDBACK_CSS } from '@/ui/shared/theme.css';
import { SIDEBAR_CSS } from '@/ui/sidebar/sidebar.css';
import { SidebarApp } from '@/ui/sidebar/SidebarApp';
import type { FolderStore } from '@/state/FolderStore';
import type { ThemeAdapter } from './ThemeAdapter';
import { locateSidebar, measureBudget, type SidebarAnchor } from './SidebarLocator';
import { XF_ATTR } from './selectors';

const log = createLogger('sidebar-mount');

export interface SidebarMountDeps {
  store: FolderStore;
  theme: ThemeAdapter;
  registry: CleanupRegistry;
  onOpenFolder: (folderId: string) => void;
}

export interface MountHandle {
  readonly element: HTMLElement;
  isConnected(): boolean;
  update(): void;
  dispose(): void;
}

/**
 * Idempotent sidebar mounting.
 *
 * `ensure()` may be called as often as the observers fire: it no-ops when the
 * host is already in the right place, re-mounts when React replaced the column,
 * converges to a single host when duplicates appear, and never becomes
 * permanently dead just because one call could not find an anchor.
 */
export class SidebarMount implements MountHandle {
  #handle: ShadowHostHandle | null = null;
  #anchor: SidebarAnchor | null = null;
  #stopResize: (() => void) | null = null;

  constructor(private readonly deps: SidebarMountDeps) {}

  get element(): HTMLElement {
    if (this.#handle === null) throw new Error('sidebar not mounted');
    return this.#handle.host;
  }

  isConnected(): boolean {
    return this.#handle?.isConnected() ?? false;
  }

  ensure(): boolean {
    const anchor = locateSidebar();
    if (anchor === null) {
      // Transient during a route change; the watchdog retries.
      log.debug('no sidebar anchor');
      return false;
    }

    // Converge first: a cloned subtree can leave a second host behind.
    const survivor = dedupeHosts(XF_ATTR.sidebarHost);
    if (
      this.#handle !== null &&
      survivor === this.#handle.host &&
      this.#handle.host.parentElement === anchor.column &&
      this.#handle.host.getAttribute('data-xf-mode') === anchor.mode
    ) {
      this.#anchor = anchor;
      this.update();
      return true;
    }

    // Anything else — moved, replaced, mode flipped, or a foreign leftover host —
    // is rebuilt from scratch so no stale listener or Preact root survives.
    if (survivor !== null && survivor !== this.#handle?.host) survivor.remove();
    this.#teardownHandle();
    this.#mount(anchor);
    return true;
  }

  #mount(anchor: SidebarAnchor): void {
    const handle = createShadowHost({
      marker: XF_ATTR.sidebarHost,
      css: `${BASE_CSS}${FEEDBACK_CSS}${SIDEBAR_CSS}`,
      theme: this.deps.theme,
      registry: this.deps.registry,
    });
    handle.host.setAttribute('data-xf-mode', anchor.mode);
    handle.host.style.display = 'block';
    handle.host.style.width = '100%';
    // Clips to the budget set in update(). Our panels, menus and dialogs are
    // position: fixed, so they are not cut off by this.
    handle.host.style.overflow = 'hidden';

    if (anchor.before !== null) anchor.column.insertBefore(handle.host, anchor.before);
    else anchor.column.appendChild(handle.host);

    render(
      <SidebarApp
        store={this.deps.store}
        mode={anchor.mode}
        onOpenFolder={this.deps.onOpenFolder}
      />,
      handle.mount,
    );

    this.#handle = handle;
    this.#anchor = anchor;
    this.#observeSize(anchor, handle);
    this.update();
    log.debug('sidebar mounted', anchor.mode, 'via', anchor.via);
  }

  #observeSize(anchor: SidebarAnchor, handle: ShadowHostHandle): void {
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => this.update());
    observer.observe(anchor.column);
    // Hold the registry handle so a re-mount takes the old observer back off the
    // registry. The shadow host next to it already self-removes, which is
    // exactly what made this one easy to miss.
    this.#stopResize = this.deps.registry.addObserver(observer);
    void handle;
  }

  /**
   * Recomputes the height budget. It caps the whole host, header included, so
   * whatever X leaves free is all we take and the account switcher can never
   * be pushed off screen; the tree scrolls inside what is left.
   */
  update(): void {
    if (this.#handle === null || this.#anchor === null) return;
    const budget = measureBudget(this.#anchor.column);
    const { host, mount } = this.#handle;
    if (budget === null) {
      host.style.maxHeight = '';
      mount.style.removeProperty('--xf-sidebar-max-height');
      return;
    }
    host.style.maxHeight = `${budget}px`;
    mount.style.setProperty('--xf-sidebar-max-height', `${budget}px`);
  }

  #teardownHandle(): void {
    if (this.#handle !== null) {
      render(null, this.#handle.mount);
      this.#handle.dispose();
      this.#handle = null;
    }
    this.#stopResize?.();
    this.#stopResize = null;
  }

  dispose(): void {
    this.#teardownHandle();
    this.#anchor = null;
  }
}
