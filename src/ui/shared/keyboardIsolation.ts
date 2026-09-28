const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/**
 * Stops keyboard events that start inside one of our shadow hosts from
 * reaching x.com.
 *
 * X binds global shortcuts on the page (N new post, R reply, T repost, J/K
 * next/previous post…). From the page's side of a shadow root, both
 * `event.target` and `document.activeElement` are our host — a plain <div> —
 * so X cannot tell the user is typing into one of our inputs and would run a
 * shortcut for every letter. Stopping propagation at the host, in the bubble
 * phase, lets our own listeners inside the root see the event first while
 * nothing above the host — X's React root, document, window — sees it at all.
 *
 * Returns a function that removes the listeners again.
 */
export function isolateKeyboard(host: HTMLElement): () => void {
  const stop = (event: Event): void => {
    event.stopPropagation();
  };
  for (const type of KEY_EVENTS) host.addEventListener(type, stop);
  return () => {
    for (const type of KEY_EVENTS) host.removeEventListener(type, stop);
  };
}
