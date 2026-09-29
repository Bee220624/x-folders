import { Icon } from '@/ui/shared/Icon';

/** A round check mark in the accent colour — our own drawing, not X's badge artwork. */
export function VerifiedBadge(): preact.JSX.Element {
  return (
    <span class="xf-tc-verified" role="img" aria-label="已认证">
      <Icon name="check" size={12} />
    </span>
  );
}
