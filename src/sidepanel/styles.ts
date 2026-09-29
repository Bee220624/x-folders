import { tokensFor } from '@/hosts/x/ThemeAdapter';
import { FOLDER_VIEW_CSS } from '@/ui/folder-view/folderView.css';
import { BASE_CSS, FEEDBACK_CSS } from '@/ui/shared/theme.css';
import { SIDEBAR_CSS } from '@/ui/sidebar/sidebar.css';
import { TWEET_CARD_CSS } from '@/ui/tweet-card/tweetCard.css';

/**
 * The side panel is an ordinary extension page, so the CSS strings the shadow
 * roots use go into one <style> in its head. `:host` rules simply do not match
 * here; `.xf-root` carries the equivalent base styles.
 *
 * M1 follows the system colour scheme. Following X's own theme arrives in a
 * later milestone.
 */
export function mountSidePanelStyles(doc: Document): void {
  const style = doc.createElement('style');
  style.textContent = `${BASE_CSS}${FEEDBACK_CSS}${SIDEBAR_CSS}${FOLDER_VIEW_CSS}${TWEET_CARD_CSS}
html, body { margin: 0; height: 100%; background: var(--xf-bg); }
#app { height: 100%; }
.xf-sp { display: flex; flex-direction: column; height: 100%; }
.xf-sp-tree { flex: 0 0 auto; max-height: 40vh; overflow-y: auto; border-bottom: 1px solid var(--xf-border); }
.xf-sp-view { flex: 1 1 auto; min-height: 0; }`;
  doc.head.appendChild(style);

  const dark = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches === true;
  for (const [name, value] of Object.entries(tokensFor(dark ? 'lightsOut' : 'light'))) {
    doc.documentElement.style.setProperty(name, value);
  }
}
