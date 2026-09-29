import { useEffect, useRef } from 'preact/hooks';
import { createIcon, type IconName } from './icons';

/** An icon built with DOM APIs (see icons.ts), for use inside components. */
export function Icon({ name, size }: { name: IconName; size: number }): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon(name, size));
  }, [name, size]);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}
