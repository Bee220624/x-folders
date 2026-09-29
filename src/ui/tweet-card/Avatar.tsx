import { avatarUrlForDisplay } from '@/utils/url';
import { SafeImage } from './SafeImage';

/** The round author picture; the name's first letter until a picture is known. */
export function Avatar(props: { url: string | null; name: string; size: 'normal' | 'small' }): preact.JSX.Element {
  const className = props.size === 'small' ? 'xf-tc-avatar xf-tc-avatar-small' : 'xf-tc-avatar';
  if (props.url === null) {
    return (
      <span class={`${className} xf-tc-avatar-empty`} aria-hidden="true">
        {Array.from(props.name.trim())[0] ?? ''}
      </span>
    );
  }
  return <SafeImage class={className} src={avatarUrlForDisplay(props.url)} alt="" />;
}
