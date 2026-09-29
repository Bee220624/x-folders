import type { TextSegment } from '@/core/domain/tweet';
import { isAllowedLinkUrl } from '@/utils/url';
import { displayLinkText } from './format';

const OUTBOUND = { target: '_blank', rel: 'noopener noreferrer' } as const;

function renderSegment(segment: TextSegment, key: number): preact.ComponentChildren {
  switch (segment.kind) {
    case 'text':
    case 'emoji':
      return segment.text;
    case 'mention':
      return (
        <a key={key} class="xf-tc-link" href={`https://x.com/${encodeURIComponent(segment.username)}`} {...OUTBOUND}>
          {segment.text}
        </a>
      );
    case 'hashtag':
      return (
        <a key={key} class="xf-tc-link" href={`https://x.com/hashtag/${encodeURIComponent(segment.tag)}`} {...OUTBOUND}>
          {segment.text}
        </a>
      );
    case 'link':
      // Checked again at render time: whatever the database holds, only
      // http(s) ever becomes a link.
      return isAllowedLinkUrl(segment.url) ? (
        <a key={key} class="xf-tc-link" href={segment.url} title={segment.url} {...OUTBOUND}>
          {displayLinkText(segment.text)}
        </a>
      ) : (
        displayLinkText(segment.text)
      );
  }
}

export interface TweetTextProps {
  segments: readonly TextSegment[];
  truncated: boolean;
  /** Where "显示更多" leads: the post itself; null when it has no safe link. */
  moreHref: string | null;
  onMore: (event: MouseEvent) => void;
}

/** Post text with links, mentions and hashtags live; newlines are kept by CSS. */
export function TweetText(props: TweetTextProps): preact.JSX.Element | null {
  if (props.segments.length === 0 && !props.truncated) return null;
  return (
    <div class="xf-tc-text" dir="auto">
      {props.segments.map(renderSegment)}
      {props.truncated && props.moreHref !== null && (
        <>
          {' '}
          <a class="xf-tc-more" href={props.moreHref} onClick={props.onMore}>
            显示更多
          </a>
        </>
      )}
    </div>
  );
}
