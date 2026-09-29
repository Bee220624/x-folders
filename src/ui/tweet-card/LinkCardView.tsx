import type { LinkCard } from '@/core/domain/tweet';
import { isAllowedLinkUrl } from '@/utils/url';
import { SafeImage } from './SafeImage';

/** The link preview: picture, domain and title, opening the link in a new tab. */
export function LinkCardView(props: { card: LinkCard }): preact.JSX.Element | null {
  const { card } = props;
  if (!isAllowedLinkUrl(card.url)) return null;
  return (
    <a class="xf-tc-card" data-layout={card.layout} href={card.url} target="_blank" rel="noopener noreferrer">
      {card.imageUrl !== null && <SafeImage class="xf-tc-card-img" src={card.imageUrl} alt="" />}
      <span class="xf-tc-card-text">
        {card.domain !== null && <span class="xf-tc-card-domain">{card.domain}</span>}
        {card.title !== null && <span class="xf-tc-card-title">{card.title}</span>}
      </span>
    </a>
  );
}
