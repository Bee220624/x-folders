import type { QuotedPost } from '@/core/domain/tweet';
import { imageUrlForSize, isSafeXUrl } from '@/utils/url';
import { Avatar } from './Avatar';
import { formatPostedAt } from './format';
import { SafeImage } from './SafeImage';
import { VerifiedBadge } from './VerifiedBadge';

export interface QuoteBlockProps {
  quote: QuotedPost;
  now: number;
  onOpen: (url: string, options: { newTab: boolean }) => void;
}

/**
 * The quoted post framed like X's. A click opens the quoted post when its link
 * is known; otherwise it falls through to the card, which opens the outer post.
 */
export function QuoteBlock(props: QuoteBlockProps): preact.JSX.Element {
  const { quote } = props;
  const href = quote.url !== null && isSafeXUrl(quote.url) ? quote.url : null;
  const name = quote.authorName ?? quote.username ?? '';
  return (
    <div
      class="xf-tc-quote"
      onClick={(event) => {
        if (href === null) return;
        event.stopPropagation();
        props.onOpen(href, { newTab: event.metaKey || event.ctrlKey });
      }}
    >
      <div class="xf-tc-quote-head">
        <Avatar url={quote.avatarUrl} name={name} size="small" />
        <span class="xf-tc-name">{name}</span>
        {quote.verified && <VerifiedBadge />}
        {quote.username !== null && <span class="xf-tc-handle">{`@${quote.username}`}</span>}
        {quote.postedAt !== null && (
          <span class="xf-tc-handle">{`· ${formatPostedAt(quote.postedAt, props.now)}`}</span>
        )}
      </div>
      <div class="xf-tc-quote-body">
        {quote.media !== null && (
          <SafeImage
            class="xf-tc-quote-thumb"
            src={imageUrlForSize(quote.media.url, 'small')}
            alt={quote.media.alt ?? ''}
          />
        )}
        {quote.text.length > 0 && (
          <div class="xf-tc-quote-text" dir="auto">
            {quote.text}
          </div>
        )}
      </div>
    </div>
  );
}
