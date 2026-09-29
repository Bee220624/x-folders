import { TWEET_TEXT_MAX } from '@/core/constants';
import type { QuotedPost } from '@/core/domain/tweet';
import { findWhere, readVisibleText } from '@/utils/dom';
import { trimTweetText } from '@/utils/text';
import { parseStatusUrl } from '@/utils/url';
import { readAuthor } from './extractAuthor';
import { readMedia } from './extractMedia';
import { readTime } from './extractPicture';
import { X_SELECTORS } from './selectors';

/**
 * A quote block as the card shows it: author, plain text, first picture.
 *
 * Measured on 2026-09-29, the block carries no link to the quoted post — its
 * time sits in a plain div — so `url` is filled only when X does render a
 * timestamped status link inside it, as older captures had.
 */
export function readQuote(quote: Element): QuotedPost {
  const author = readAuthor(quote, []);
  const textNode = quote.querySelector(X_SELECTORS.tweetText);
  const link = findWhere(
    quote,
    X_SELECTORS.statusLink,
    (candidate) => candidate.querySelector(X_SELECTORS.time) !== null,
  );
  const parsed = link instanceof HTMLAnchorElement ? parseStatusUrl(link.href) : null;
  return {
    authorName: author.authorName,
    username: author.handle,
    verified: author.verified,
    avatarUrl: author.avatarUrl,
    postedAt: readTime(quote.querySelector(X_SELECTORS.time)),
    text: textNode === null ? '' : trimTweetText(readVisibleText(textNode), TWEET_TEXT_MAX),
    media: readMedia(quote, [])[0] ?? null,
    url: parsed === null ? null : parsed.canonicalUrl,
  };
}
