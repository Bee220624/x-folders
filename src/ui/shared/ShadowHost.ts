import type { CleanupRegistry } from '@/utils/cleanup';
import type { ThemeAdapter } from '@/hosts/x/ThemeAdapter';
import { isolateKeyboard } from './keyboardIsolation';
import { shadowMode } from './shadowMode';

export interface ShadowHostOptions {
  /** Attribute marking the host, e.g. `data-xf-sidebar-host`. */
  marker: string;
  css: string;
  theme: ThemeAdapter;
  registry: CleanupRegistry;
}

export interface ShadowHostHandle {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** The element UI should render into. */
  readonly mount: HTMLElement;
  isConnected(): boolean;
  dispose(): void;
}

/**
 * Host element → its shadow root. The only way to get from a host found in the
 * DOM back to its root, now that the roots are closed. Module-private and
 * living in the isolated world, so the page cannot read it.
 */
const roots = new WeakMap<HTMLElement, ShadowRoot>();

/**
 * Creates a marked host element with a closed shadow root and the given CSS
 * already inside it.
 *
 * Styles live in the shadow root, never in the page document. WXT's default
 * `cssInjectionMode: 'manifest'` would write our CSS into
 * `manifest.content_scripts[].css` — injected into x.com's own document, where
 * it both leaks selectors into X's DOM and cannot cross a shadow boundary to
 * reach the UI it was written for.
 *
 * The root is `closed` because these hosts hang in x.com's own document: with
 * `open`, any page script could read the user's entire folder tree out of
 * `document.querySelector('[data-xf-sidebar-host]').shadowRoot.textContent`,
 * and the saved-tweet authors and text out of the overlay host. Patching
 * `Element.prototype.attachShadow` does not get around this: content scripts
 * run in an isolated world with their own prototypes, so a page-side patch
 * never sees our calls.
 *
 * Keyboard events are stopped at the host (see `isolateKeyboard`): from the
 * page's side, a user typing into our input looks like key presses on a plain
 * <div>, which X would run as shortcuts.
 */
export function createShadowHost(options: ShadowHostOptions): ShadowHostHandle {
  const host = document.createElement('div');
  host.setAttribute(options.marker, '');

  const root = host.attachShadow({ mode: shadowMode() });
  roots.set(host, root);
  const style = document.createElement('style');
  style.textContent = options.css;
  root.appendChild(style);

  const mount = document.createElement('div');
  mount.className = 'xf-root';
  root.appendChild(mount);

  const unregisterTheme = options.theme.register(host);
  const releaseKeyboard = isolateKeyboard(host);
  // The handle both runs the teardown and takes it off the registry, so calling
  // dispose() early and letting the registry dispose later are the same thing.
  const teardown = options.registry.add(() => {
    releaseKeyboard();
    unregisterTheme();
    host.remove();
  });

  return {
    host,
    root,
    mount,
    isConnected: () => host.isConnected,
    dispose: teardown,
  };
}

/**
 * The shadow root of a host we created, or `null` for anything else.
 *
 * Consumers that hold a `ShadowHostHandle` should use `handle.root`; this is for
 * the case a closed root took away — starting from a host element found in the
 * DOM.
 */
export function shadowRootOf(host: HTMLElement | null | undefined): ShadowRoot | null {
  return host == null ? null : (roots.get(host) ?? null);
}

/** Removes stray hosts, keeping the first. Returns the survivor, if any. */
export function dedupeHosts(marker: string, scope: ParentNode = document): HTMLElement | null {
  const hosts = Array.from(scope.querySelectorAll<HTMLElement>(`[${marker}]`));
  for (const extra of hosts.slice(1)) extra.remove();
  return hosts[0] ?? null;
}
