/**
 * Every X selector lives here. Nothing else in the codebase may query x.com's
 * DOM by string.
 *
 * Rules, in priority order:
 *  1. `data-testid` first — X derives these from component names and they move
 *     far less often than anything else.
 *  2. Structural/semantic fallbacks (role, tag, relative position) second.
 *  3. Never X's obfuscated `r-xxxxxxxx` class names, never deep `nth-child`
 *     paths, never localisable `aria-label` text.
 *
 * Verified against real x.com DOM captured 2026-09-03 (see tests/fixtures).
 * Measured again on 2026-09-29 for snapshots (see the M2 plan).
 * Notes on things that are NOT what you would expect:
 *  - There is no `[data-testid="AppTabBar"]` container; only per-item
 *    `AppTabBar_*_Link` anchors exist.
 *  - A quoted tweet is NOT a nested `[data-testid="tweet"]`. It is a
 *    `div[role="link"][tabindex="0"]` inside the same <article>, carrying its
 *    own User-Name, time, status anchor and tweetText.
 *  - `[data-testid="bookmark"]` appears on status pages but NOT in the home
 *    timeline's action bar, where bookmarking lives inside the share menu.
 */
export const X_SELECTORS = {
  reactRoot: '#react-root',
  layers: '#layers',

  /** Timeline row wrapper; the virtualiser's unit of work. */
  cellInnerDiv: '[data-testid="cellInnerDiv"]',
  tweetRoot: 'article[data-testid="tweet"]',
  /** The permalink page's subject tweet. */
  focusedTweet: 'article[data-testid="tweet"][tabindex="-1"]',

  tweetText: '[data-testid="tweetText"]',
  userName: '[data-testid="User-Name"]',
  statusLink: 'a[href*="/status/"]',
  /** Quoted-tweet wrapper — see the note above. */
  quoteContainer: 'div[role="link"][tabindex="0"]',
  /**
   * X's promotion/tracking marker. Not an ad signal on its own: X also puts it
   * on ordinary posts, so extractTweet only skips it when no real permalink
   * exists.
   */
  promoted: '[data-testid="placementTracking"]',
  socialContext: '[data-testid="socialContext"]',
  card: '[data-testid="card.wrapper"]',
  /** Author avatar block; inside a quote it belongs to the quoted author. */
  avatar: '[data-testid="Tweet-User-Avatar"]',
  /** Blue, gold and grey checks all use this id; it sits inside User-Name. */
  verifiedBadge: '[data-testid="icon-verified"]',
  /**
   * The timeline's cut of a long post. A sibling of tweetText, not inside it;
   * a post's own page shows the full text and has none.
   */
  showMore: '[data-testid="tweet-text-show-more-link"]',
  /** One picture or video cell; a video nests videoPlayer > videoComponent > video in it. */
  mediaCell: '[data-testid="tweetPhoto"]',
  cardSmallMedia: '[data-testid="card.layoutSmall.media"]',
  video: 'video',
  time: 'time',
  /** Leaf text runs inside User-Name and cards. */
  textRun: 'span',
  image: 'img[src]',
  /** X paints avatars and posters a second time as a CSS background. */
  backgroundImage: '[style*="background-image"]',
  anyLink: 'a[href]',

  actionGroup: 'div[role="group"]',
  reply: '[data-testid="reply"]',
  repost: '[data-testid="retweet"], [data-testid="unretweet"]',
  like: '[data-testid="like"], [data-testid="unlike"]',
  bookmark: '[data-testid="bookmark"], [data-testid="removeBookmark"]',

  primaryColumn: '[data-testid="primaryColumn"]',
  sidebarColumn: '[data-testid="sidebarColumn"]',
  banner: 'header[role="banner"]',
  navRoot: 'header[role="banner"] nav',
  navItem: '[data-testid^="AppTabBar_"]',
  newTweetButton: '[data-testid="SideNav_NewTweet_Button"]',
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
} as const;

/** Attributes/classes the extension owns. All extension DOM is findable by these. */
export const XF_ATTR = {
  actionHost: 'data-xf-action-host',
  tweetId: 'data-xf-tweet-id',
  skip: 'data-xf-skip',
  sidebarHost: 'data-xf-sidebar-host',
  /** Page-level layer for the sidebar's panel, menu, dialog and toasts. */
  sidebarLayerHost: 'data-xf-sidebar-layer-host',
  overlayHost: 'data-xf-overlay-host',
  popoverHost: 'data-xf-popover-host',
} as const;

/** Known action ids used to decide whether a role=group really is the action bar. */
export const ACTION_SELECTORS = [
  X_SELECTORS.reply,
  X_SELECTORS.repost,
  X_SELECTORS.like,
  X_SELECTORS.bookmark,
] as const;
