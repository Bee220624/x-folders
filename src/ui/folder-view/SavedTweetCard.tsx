import type { SavedTweetView } from '@/core/domain/membership';
import type { TweetId } from '@/core/domain/tweet';
import { XF_ATTR } from '@/hosts/x/selectors';
import { Icon } from '@/ui/shared/Icon';
import { formatDay } from '@/ui/tweet-card/format';
import { TweetCard, type OpenOptions } from '@/ui/tweet-card/TweetCard';

/** Keeps the ⋯ menu inside the viewport's left edge. */
const MENU_WIDTH_PX = 180;

export interface SavedTweetCardProps {
  item: SavedTweetView;
  /** Render-time clock, passed in so every row in one paint agrees. */
  now: number;
  removing: boolean;
  onOpen: (url: string, options: OpenOptions) => void;
  /** Opens this post's ⋯ menu at a viewport point. */
  onMenu: (tweetId: TweetId, x: number, y: number) => void;
}

/** One saved post in a folder: the rich card, its ⋯ menu and the day it was saved. */
export function SavedTweetCard(props: SavedTweetCardProps): preact.JSX.Element {
  const { tweet, savedAt } = props.item;
  return (
    <div
      class="xf-fv-row"
      data-removing={props.removing ? 'true' : 'false'}
      {...{ [XF_ATTR.tweetId]: tweet.tweetId }}
    >
      <TweetCard
        tweet={tweet}
        now={props.now}
        onOpen={props.onOpen}
        actions={
          <button
            type="button"
            class="xf-icon-button"
            aria-label="更多操作"
            aria-haspopup="menu"
            title="更多操作"
            disabled={props.removing}
            onClick={(event) => {
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              props.onMenu(tweet.tweetId, Math.max(8, rect.right - MENU_WIDTH_PX), rect.bottom + 4);
            }}
          >
            <Icon name="more" size={18} />
          </button>
        }
        footer={<div class="xf-tc-saved">{`保存于 ${formatDay(savedAt, props.now)}`}</div>}
      />
    </div>
  );
}
