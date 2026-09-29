import { useState } from 'preact/hooks';
import { isAllowedImageUrl } from '@/utils/url';

export interface SafeImageProps {
  src: string;
  alt: string;
  class?: string;
}

/**
 * A picture from X's image server that becomes a grey placeholder when it
 * cannot be shown: a URL outside the allow-list (checked again here, whatever
 * the database holds), a deleted post, no network. Pictures are referenced,
 * never downloaded (work order 2.4).
 */
export function SafeImage(props: SafeImageProps): preact.JSX.Element {
  const [broken, setBroken] = useState(false);
  const className = props.class === undefined ? 'xf-tc-img' : `xf-tc-img ${props.class}`;
  if (broken || !isAllowedImageUrl(props.src)) {
    return <span class={`${className} xf-tc-img-missing`} role="img" aria-label={props.alt || '图片无法显示'} />;
  }
  return (
    <img
      class={className}
      src={props.src}
      alt={props.alt}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}
