/**
 * Reads an element's user-visible text without `innerText`.
 *
 * `innerText` is layout-dependent and is not implemented by jsdom at all, so a
 * fixture test would silently read `undefined`. This walk is deterministic in
 * both environments: `<br>` and block boundaries become newlines, and `<img>`
 * contributes its `alt`, which is how X renders emoji inside tweet text.
 */
export function readVisibleText(root: Element): string {
  const parts: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();

    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    if (tag === 'img') {
      parts.push(element.getAttribute('alt') ?? '');
      return;
    }
    if (tag === 'script' || tag === 'style' || tag === 'svg') return;

    for (const child of Array.from(element.childNodes)) visit(child);
  };

  visit(root);
  return parts.join('');
}

/** True when `node` is inside any of `containers`. */
export function isInsideAny(node: Node, containers: readonly Element[]): boolean {
  return containers.some((container) => container.contains(node));
}

/** First element matching `selector` inside `root` that passes `predicate`. */
export function findWhere(
  root: ParentNode,
  selector: string,
  predicate: (element: Element) => boolean,
): Element | null {
  for (const element of Array.from(root.querySelectorAll(selector))) {
    if (predicate(element)) return element;
  }
  return null;
}

/** Removes every node in `nodes` from its parent. */
export function removeAll(nodes: Iterable<Element>): void {
  for (const node of nodes) node.remove();
}
