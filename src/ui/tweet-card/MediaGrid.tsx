import type { MediaItem } from '@/core/domain/tweet';
import { Icon } from '@/ui/shared/Icon';
import { imageUrlForSize } from '@/utils/url';
import { SafeImage } from './SafeImage';

/**
 * One to four pictures laid out as X does: one fills the frame, two side by
 * side, three as one tall and two stacked, four in a 2×2 grid. A video or GIF
 * shows its poster with a play mark or a "GIF" badge; nothing plays here.
 */
export function MediaGrid(props: { media: readonly MediaItem[] }): preact.JSX.Element | null {
  const items = props.media.slice(0, 4);
  if (items.length === 0) return null;
  const size = items.length === 1 ? 'medium' : 'small';
  return (
    <div class="xf-tc-media" data-count={items.length}>
      {items.map((item, index) => (
        <div key={index} class="xf-tc-media-cell">
          <SafeImage src={imageUrlForSize(item.url, size)} alt={item.alt ?? ''} />
          {item.kind === 'video' && (
            <span class="xf-tc-play">
              <Icon name="play" size={24} />
            </span>
          )}
          {item.kind === 'gif' && <span class="xf-tc-gif">GIF</span>}
        </div>
      ))}
    </div>
  );
}
