import { useEffect, useRef } from 'preact/hooks';
import type { SavedTweetView } from '@/core/domain/membership';
import type { TweetId } from '@/core/domain/tweet';
import { XF_ATTR } from '@/hosts/x/selectors';
import { createIcon, type IconName } from '@/ui/shared/icons';
import { isSafeXUrl } from '@/utils/url';

/** Enough to recognise a post; the full text lives one click away. */
const EXCERPT_MAX = 240;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Relative Chinese time. Anything older than a month becomes an absolute date:
 * 「87 天前」 tells a reader nothing they can act on.
 */
export function formatSavedAt(savedAt: number, now: number): string {
  const elapsed = now - savedAt;
  if (elapsed < MINUTE_MS) return '刚刚';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时前`;
  if (elapsed < MONTH_MS) return `${Math.floor(elapsed / DAY_MS)} 天前`;
  const date = new Date(savedAt);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function excerptOf(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX)}…` : trimmed;
}

function Icon({ name, size }: { name: IconName; size: number }): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon(name, size));
  }, [name, size]);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}

export interface SavedTweetCardProps {
  item: SavedTweetView;
  /** Render-time clock, passed in so every row in one paint agrees. */
  now: number;
  removing: boolean;
  onRemove: (tweetId: TweetId) => void;
}

export function SavedTweetCard(props: SavedTweetCardProps): preact.JSX.Element {
  const { tweet } = props.item;
  const excerpt = excerptOf(tweet.text);
  // A stored URL that fails the same-origin guard is dropped rather than
  // rendered inert: the row still shows what was saved, it just is not a link.
  const href = isSafeXUrl(tweet.canonicalUrl) ? tweet.canonicalUrl : null;

  const body = (
    <>
      <div class="xf-fv-meta">
        <span class="xf-fv-author">{tweet.authorName ?? tweet.username}</span>
        <span class="xf-fv-handle">{`@${tweet.username}`}</span>
        <span class="xf-fv-time">{formatSavedAt(props.item.savedAt, props.now)}</span>
        {href !== null && (
          <span class="xf-fv-open">
            <Icon name="external" size={16} />
          </span>
        )}
      </div>
      <p class="xf-fv-text" data-empty={excerpt.length === 0 ? 'true' : 'false'}>
        {excerpt.length === 0 ? '（无正文）' : excerpt}
      </p>
    </>
  );

  return (
    <div class="xf-fv-row" {...{ [XF_ATTR.tweetId]: tweet.tweetId }}>
      {href !== null ? (
        // A real same-origin anchor, so the row navigates in the current tab
        // exactly like one of X's own links — no synthetic location writes.
        <a class="xf-fv-card" href={href} title="打开原帖">
          {body}
        </a>
      ) : (
        <div class="xf-fv-card">{body}</div>
      )}
      <button
        type="button"
        class="xf-fv-remove"
        aria-label="从当前文件夹移除"
        title="从当前文件夹移除"
        disabled={props.removing}
        onClick={() => props.onRemove(tweet.tweetId)}
      >
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}
