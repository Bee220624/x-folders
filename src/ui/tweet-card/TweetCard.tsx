import type { TweetRecord } from '@/core/domain/tweet';
import { isSafeXUrl } from '@/utils/url';
import { Avatar } from './Avatar';
import { formatPostedAt } from './format';
import { LinkCardView } from './LinkCardView';
import { MediaGrid } from './MediaGrid';
import { QuoteBlock } from './QuoteBlock';
import { TweetText } from './TweetText';
import { VerifiedBadge } from './VerifiedBadge';

export interface OpenOptions {
  /** ⌘/Ctrl-click: a new tab. */
  newTab: boolean;
}

export interface TweetCardProps {
  tweet: TweetRecord;
  /** Render-time clock, passed in so every card in one paint agrees. */
  now: number;
  /** Opens a post; the page overlay and the side panel each decide how. */
  onOpen: (url: string, options: OpenOptions) => void;
  /** Top-right corner — the folder view puts its ⋯ menu here. */
  actions?: preact.ComponentChildren;
  /** Under the body — the folder view puts "保存于 …" here. */
  footer?: preact.ComponentChildren;
}

/** Controls that handle their own clicks; clicking one never opens the card. */
const INTERACTIVE = 'a, button, [role="menu"], [role="menuitem"]';

/**
 * A saved post drawn as close to X's own card as a snapshot allows (work order
 * 2.4): avatar, name, check mark, @handle and time; text with live links; up to
 * four pictures; the quoted post; the link preview. No counts — they would be
 * stale. A click anywhere that is not a control opens the post, as on X; the
 * time is the post's real link, for keyboards and screen readers.
 */
export function TweetCard(props: TweetCardProps): preact.JSX.Element {
  const { tweet } = props;
  // A stored URL that fails the same-origin guard is never opened.
  const href = isSafeXUrl(tweet.canonicalUrl) ? tweet.canonicalUrl : null;
  const name = tweet.authorName ?? tweet.username;

  const open = (event: MouseEvent): void => {
    if (href === null) return;
    props.onOpen(href, { newTab: event.metaKey || event.ctrlKey });
  };
  const openFromLink = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    open(event);
  };

  return (
    <article
      class="xf-tc"
      onClick={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(INTERACTIVE) !== null) return;
        // Selecting text to copy it is not a click on the card.
        if ((window.getSelection()?.toString() ?? '').length > 0) return;
        open(event);
      }}
    >
      <Avatar url={tweet.avatarUrl} name={name} size="normal" />
      <div class="xf-tc-main">
        <div class="xf-tc-head">
          <span class="xf-tc-name">{name}</span>
          {tweet.verified && <VerifiedBadge />}
          <span class="xf-tc-handle">{`@${tweet.username}`}</span>
          {href !== null && (
            <>
              <span class="xf-tc-handle" aria-hidden="true">
                ·
              </span>
              <a class="xf-tc-time" href={href} onClick={openFromLink}>
                {tweet.postedAt === null ? '打开原帖' : formatPostedAt(tweet.postedAt, props.now)}
              </a>
            </>
          )}
          {props.actions !== undefined && <span class="xf-tc-actions">{props.actions}</span>}
        </div>
        <TweetText segments={tweet.segments} truncated={tweet.truncated} moreHref={href} onMore={openFromLink} />
        <MediaGrid media={tweet.media} />
        {tweet.quote !== null && <QuoteBlock quote={tweet.quote} now={props.now} onOpen={props.onOpen} />}
        {tweet.card !== null && tweet.media.length === 0 && <LinkCardView card={tweet.card} />}
        {props.footer}
      </div>
    </article>
  );
}
