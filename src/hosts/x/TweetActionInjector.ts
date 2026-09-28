import type { TweetId } from '@/core/domain/tweet';
import { createIcon } from '@/ui/shared/icons';
import { isolateKeyboard } from '@/ui/shared/keyboardIsolation';
import { createLogger } from '@/utils/logger';
import { findActionGroup } from './ActionGroupLocator';
import { XF_ATTR } from './selectors';

const log = createLogger('inject');

export interface ActionButtonState {
  tweetId: TweetId;
  savedCount: number;
}

export interface InjectionResult {
  host: HTMLElement;
  created: boolean;
}

export type ActionClickHandler = (tweetId: TweetId, anchor: HTMLElement) => void;

const HOST_SELECTOR = `[${XF_ATTR.actionHost}]`;

const BUTTON_STYLE = `
:host { display: inline-flex; align-items: center; flex-grow: 0; flex-shrink: 0; }
button {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34.75px;
  height: 34.75px;
  margin: -8px 0;
  border-radius: 9999px;
  cursor: pointer;
  color: var(--xf-text-muted, rgb(83, 100, 113));
  transition: color .15s ease, background-color .15s ease;
}
button:hover { color: var(--xf-accent, rgb(29, 155, 240)); background-color: var(--xf-accent-soft, rgba(29, 155, 240, .1)); }
button:focus-visible { outline: 2px solid var(--xf-accent, rgb(29, 155, 240)); outline-offset: 2px; }
button[data-saved="true"] { color: var(--xf-accent, rgb(29, 155, 240)); }
`;

/**
 * Host element → the button inside its closed shadow root.
 *
 * Module-private and living in the isolated world, so the page cannot read it.
 * It is keyed by host rather than held per injector instance so that
 * `buttonFor` can serve callers that only have the host element, such as the
 * popover returning focus to its anchor.
 */
const buttons = new WeakMap<HTMLElement, HTMLButtonElement>();

/**
 * Injects and maintains exactly one folder button per tweet action bar.
 *
 * The button is plain DOM inside a minimal shadow root — one Preact root per
 * timeline row would mean hundreds of framework instances on a long scroll.
 *
 * Identity is carried on the host as `data-xf-tweet-id` rather than tracked in
 * a WeakSet. X can reuse a DOM node for a different tweet, and a WeakSet would
 * report "already handled" while the button still showed the previous tweet's
 * saved state.
 *
 * The shadow root is `closed`: the host sits in x.com's own document, and an
 * open root would let any page script walk our UI. Key presses on the button
 * are stopped at the host so X never mistakes them for its own shortcuts.
 */
export class TweetActionInjector {
  readonly #onClick: ActionClickHandler;

  constructor(onClick: ActionClickHandler) {
    this.#onClick = onClick;
  }

  /** Idempotent: safe to call repeatedly for the same tweet root. */
  ensure(root: HTMLElement, state: ActionButtonState): InjectionResult | null {
    const match = findActionGroup(root);
    if (match === null) {
      // No qualifying action group yet; a later mutation or the watchdog retries.
      log.debug('no action group', state.tweetId);
      return null;
    }

    const existing = Array.from(match.group.querySelectorAll<HTMLElement>(HOST_SELECTOR));
    // Converge on exactly one host: duplicates can appear if X clones a subtree.
    for (const extra of existing.slice(1)) extra.remove();
    const current = existing[0] ?? null;

    if (current !== null) {
      // `buttons.has` is the second half of the test, not a formality. A host
      // left over from a previous content-script context — an extension reload
      // that left its nodes in X's DOM — carries the right attribute but its
      // closed root is unreachable from here, because the WeakMap holding the
      // button died with that context. Repainting it would silently no-op and
      // leave a dead button on the tweet forever, so it gets rebuilt.
      if (current.getAttribute(XF_ATTR.tweetId) === state.tweetId && buttons.has(current)) {
        this.#applyState(current, state);
        return { host: current, created: false };
      }
      // Node recycled for a different tweet: rebuild rather than repaint, so no
      // stale listener or icon state survives.
      current.remove();
    }

    const host = this.#createHost(state);
    if (match.bookmarkSlot !== null) {
      match.bookmarkSlot.after(host);
    } else {
      match.group.appendChild(host);
    }
    return { host, created: true };
  }

  #createHost(state: ActionButtonState): HTMLElement {
    const host = document.createElement('div');
    host.setAttribute(XF_ATTR.actionHost, '');
    host.setAttribute(XF_ATTR.tweetId, state.tweetId);

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BUTTON_STYLE;
    shadow.appendChild(style);

    const button = document.createElement('button');
    button.type = 'button';
    button.appendChild(createIcon('folderOutline'));

    button.addEventListener('click', (event) => {
      // X makes the whole tweet card clickable; without both of these the click
      // navigates to the post. Neither the native bookmark nor any other X
      // action listener is touched — this is a brand new element.
      event.preventDefault();
      event.stopPropagation();
      const tweetId = host.getAttribute(XF_ATTR.tweetId);
      if (tweetId !== null) this.#onClick(tweetId, host);
    });
    // X listens on the capture phase for card navigation on mousedown too.
    button.addEventListener('mousedown', (event) => event.stopPropagation());

    shadow.appendChild(button);
    // Removed together with the host; there is nothing to unregister.
    isolateKeyboard(host);
    // Registered before the first paint: #applyState resolves the button here.
    buttons.set(host, button);
    this.#applyState(host, state);
    return host;
  }

  #applyState(host: HTMLElement, state: ActionButtonState): void {
    host.setAttribute(XF_ATTR.tweetId, state.tweetId);
    const button = buttons.get(host);
    if (button === undefined) return;

    const saved = state.savedCount > 0;
    button.setAttribute('data-saved', String(saved));
    const label = saved ? `已保存到 ${state.savedCount} 个文件夹` : '保存到文件夹';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);

    const wanted = saved ? 'folderFilled' : 'folderOutline';
    if (button.getAttribute('data-icon') !== wanted) {
      button.setAttribute('data-icon', wanted);
      button.querySelector('svg')?.remove();
      button.appendChild(createIcon(wanted));
    }
  }

  /**
   * The button inside a host's closed shadow root, or `null` if this context
   * did not create that host. The one supported way in, now that
   * `host.shadowRoot` is `null` for us too.
   */
  static buttonFor(host: HTMLElement | null | undefined): HTMLButtonElement | null {
    return host == null ? null : (buttons.get(host) ?? null);
  }

  /** Removes every injected host in `scope`. Used on dispose. */
  static removeAll(scope: ParentNode = document): void {
    for (const host of scope.querySelectorAll(HOST_SELECTOR)) host.remove();
  }

  static hostsIn(scope: ParentNode = document): HTMLElement[] {
    return Array.from(scope.querySelectorAll<HTMLElement>(HOST_SELECTOR));
  }
}
