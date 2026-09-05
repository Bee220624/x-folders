import { useEffect, useRef } from 'preact/hooks';
import { createIcon, type IconName } from '@/ui/shared/icons';

export interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  disabled?: boolean;
  danger?: boolean;
}

export interface FolderContextMenuProps {
  items: readonly MenuItem[];
  x: number;
  y: number;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function Icon({ name }: { name: IconName }): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (host === null) return;
    host.replaceChildren(createIcon(name, 16));
  }, [name]);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}

export function FolderContextMenu(props: FolderContextMenuProps): preact.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    menuRef.current?.querySelector('button')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [props]);

  // Kept inside the viewport without a positioning library: the menu is small
  // and its own size is known once rendered.
  const style = `left:${Math.min(props.x, Math.max(0, window.innerWidth - 190))}px;` +
    `top:${Math.min(props.y, Math.max(0, window.innerHeight - 40 - props.items.length * 38))}px;`;

  return (
    <div class="xf-menu-layer" onClick={props.onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={menuRef}
        class="xf-menu xf-menu-anchored"
        role="menu"
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        {props.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            class="xf-menu-item"
            data-danger={item.danger === true ? 'true' : 'false'}
            disabled={item.disabled === true}
            onClick={() => {
              if (item.disabled === true) return;
              props.onSelect(item.id);
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
