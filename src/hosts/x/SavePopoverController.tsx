import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { render } from 'preact';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import type { FolderStore } from '@/state/FolderStore';
import { SAVE_POPOVER_CSS } from '@/ui/save-popover/popover.css';
import { SavePopoverApp } from '@/ui/save-popover/SavePopoverApp';
import { createShadowHost, dedupeHosts, type ShadowHostHandle } from '@/ui/shared/ShadowHost';
import { BASE_CSS } from '@/ui/shared/theme.css';
import type { CleanupRegistry, Disposer } from '@/utils/cleanup';
import { createLogger } from '@/utils/logger';
import type { ThemeAdapter } from './ThemeAdapter';
import { TweetActionInjector } from './TweetActionInjector';
import { XF_ATTR } from './selectors';

const log = createLogger('save-popover');

/** Gap between the action button and the popover. */
const ANCHOR_GAP_PX = 6;
/** Minimum distance kept from every viewport edge. */
const VIEWPORT_PADDING_PX = 8;

export interface SavePopoverDeps {
  store: FolderStore;
  theme: ThemeAdapter;
  registry: CleanupRegistry;
  /** Resolve the record to save from the clicked button's host element. Returns null if the tweet is no longer extractable. */
  resolveTweet: (tweetId: string, anchor: HTMLElement) => TweetRecord | null;
  /** Called after any membership change so the action button icon updates immediately. */
  onMembershipChanged: (tweetId: string, membershipCount: number) => void;
}

/**
 * Owns the one save popover the page is allowed to have.
 *
 * The host hangs off <body> rather than off the tweet card: a card is a stack of
 * `overflow: hidden` containers, and a popover mounted inside one would be
 * clipped by the row it belongs to.
 */
export class SavePopoverController {
  #handle: ShadowHostHandle | null = null;
  #anchor: HTMLElement | null = null;
  #stopAutoUpdate: (() => void) | null = null;
  #detachListeners: Disposer | null = null;
  /**
   * Bumped on every open and close. Anything asynchronous captures the value it
   * started with, so a reply that arrives after the popover went away — or after
   * it reopened on another tweet — is dropped instead of applied.
   */
  #generation = 0;

  constructor(private readonly deps: SavePopoverDeps) {}

  isOpen(): boolean {
    return this.#handle !== null;
  }

  open(tweetId: TweetId, anchor: HTMLElement): void {
    // Never two: a second open replaces the first rather than stacking on it.
    this.#teardown(false);
    // A host can also survive a torn-down controller (an invalidated context, a
    // cloned subtree); converge before adding one more.
    dedupeHosts(XF_ATTR.popoverHost)?.remove();

    const ticket = ++this.#generation;
    const handle = createShadowHost({
      marker: XF_ATTR.popoverHost,
      css: `${BASE_CSS}${SAVE_POPOVER_CSS}`,
      theme: this.deps.theme,
      registry: this.deps.registry,
    });
    handle.host.setAttribute(XF_ATTR.tweetId, tweetId);
    handle.host.style.position = 'fixed';
    handle.host.style.top = '0';
    handle.host.style.left = '0';
    handle.host.style.zIndex = '9999';
    document.body.appendChild(handle.host);

    this.#handle = handle;
    this.#anchor = anchor;

    render(
      <SavePopoverApp
        store={this.deps.store}
        tweetId={tweetId}
        resolveTweet={() => this.deps.resolveTweet(tweetId, anchor)}
        onMembershipChanged={(count) => {
          if (ticket !== this.#generation) return;
          this.deps.onMembershipChanged(tweetId, count);
        }}
        onRequestClose={() => {
          if (ticket !== this.#generation) return;
          this.close();
        }}
      />,
      handle.mount,
    );

    this.#stopAutoUpdate = autoUpdate(anchor, handle.host, () => {
      void this.#position(ticket, anchor, handle.host);
    });
    this.#listen();
    log.debug('opened', tweetId);
  }

  close(): void {
    this.#teardown(true);
  }

  /** Called by the health monitor each tick; closes if the anchor left the DOM. */
  ensure(): void {
    if (this.#handle === null) return;
    // A route change can take the tweet — or our own host — out of the document
    // while no pointer or key event ever reaches us.
    if (this.#anchor?.isConnected !== true || !this.#handle.isConnected()) {
      this.#teardown(false);
    }
  }

  dispose(): void {
    this.#teardown(false);
  }

  async #position(ticket: number, anchor: HTMLElement, host: HTMLElement): Promise<void> {
    const { x, y } = await computePosition(anchor, host, {
      placement: 'bottom-end',
      strategy: 'fixed',
      middleware: [
        offset(ANCHOR_GAP_PX),
        flip({ padding: VIEWPORT_PADDING_PX }),
        shift({ padding: VIEWPORT_PADDING_PX }),
      ],
    });
    // computePosition resolves a frame later; by then the popover may be gone.
    if (ticket !== this.#generation || this.#handle?.host !== host) return;
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
  }

  #listen(): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      this.close();
    };
    // Pointerdown, not click: X navigates the card on mousedown, and dismissing
    // on the way down keeps the popover from outliving the gesture that killed it.
    const onPointerDown = (event: Event): void => {
      const path = event.composedPath();
      const handle = this.#handle;
      if (handle === null) return;
      if (path.includes(handle.host)) return;
      if (this.#anchor !== null && path.includes(this.#anchor)) return;
      this.close();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    const detach = (): void => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
    const unregister = this.deps.registry.add(detach);
    this.#detachListeners = () => {
      unregister();
      detach();
    };
  }

  #teardown(restoreFocus: boolean): void {
    const handle = this.#handle;
    const anchor = this.#anchor;
    this.#handle = null;
    this.#anchor = null;
    if (handle === null) return;

    // Invalidate first: disposing the Preact root can synchronously run code
    // that would otherwise still consider itself current.
    this.#generation += 1;
    this.#detachListeners?.();
    this.#detachListeners = null;
    this.#stopAutoUpdate?.();
    this.#stopAutoUpdate = null;
    render(null, handle.mount);
    handle.dispose();

    if (restoreFocus && anchor !== null && anchor.isConnected) {
      // The anchor's root is closed, so the button comes from the injector's
      // own lookup rather than a query through `anchor.shadowRoot`.
      TweetActionInjector.buttonFor(anchor)?.focus();
    }
  }
}
