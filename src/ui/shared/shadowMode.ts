/**
 * Closed in every real build: our hosts live in x.com's document, and an open
 * root would let any page script read the user's folders and saved posts.
 *
 * The one exception is the Playwright build (`wxt build --mode e2e`, output in
 * `dist/chrome-mv3-e2e`). Browser tests have to click through the popover and
 * the sidebar, and neither Playwright nor the page can reach into a closed
 * root. That build is only ever loaded by the test harness.
 */
export function shadowMode(): ShadowRootMode {
  return import.meta.env.MODE === 'e2e' ? 'open' : 'closed';
}
