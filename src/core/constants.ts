/** Shared, environment-free constants. Safe to import from any context. */

/** Dexie database name. */
export const DB_NAME = 'x-folders-db';

/** Root folders have `parentId === null`; one level of children is allowed. */
export const MAX_FOLDER_DEPTH = 2;

/** Folder name length limits, measured after trimming + Unicode normalisation. */
export const FOLDER_NAME_MIN = 1;
export const FOLDER_NAME_MAX = 64;

/** Gap left between sibling `position` values so inserts rarely need a rewrite. */
export const POSITION_STEP = 1000;

/** Hard cap on stored tweet text. */
export const TWEET_TEXT_MAX = 50_000;

/** Page size for folder listings. The RPC layer clamps to this. */
export const FOLDER_TWEETS_PAGE_SIZE = 50;

/** Most-recently-used folders shown at the top of the save popover. */
export const RECENT_FOLDERS_MAX = 3;

/** Largest batch accepted by `memberships.getCountsForTweets`. */
export const MEMBERSHIP_COUNT_BATCH_MAX = 100;

/** `chrome.storage.local` key carrying the cross-tab change record. */
export const CHANGE_CHANNEL_KEY = 'xf:change';

/**
 * `chrome.storage.local` key that turns on debug logging. Set to `true`.
 *
 * Extension storage, not `localStorage`: in a content script `localStorage`
 * belongs to the *page* origin, so x.com — or anything it loads — could flip
 * our log level and leave it flipped.
 */
export const DEBUG_FLAG_KEY = 'xf:debug';

/** Prefix for every attribute and CSS class the extension injects into X. */
export const DOM_PREFIX = 'xf';
