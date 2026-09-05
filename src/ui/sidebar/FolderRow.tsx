import { useEffect, useRef } from 'preact/hooks';
import type { FolderTreeNode } from '@/core/domain/folder';
import { createIcon } from '@/ui/shared/icons';

export interface FolderRowProps {
  node: FolderTreeNode;
  active: boolean;
  expanded: boolean;
  onToggle: (node: FolderTreeNode) => void;
  onOpen: (node: FolderTreeNode) => void;
  onMenu: (node: FolderTreeNode, x: number, y: number) => void;
  onBeginRename: (node: FolderTreeNode) => void;
}

function useIcon(name: 'chevronRight' | 'folderOutline' | 'more', size: number): {
  ref: preact.RefObject<HTMLSpanElement>;
} {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon(name, size));
  }, [name, size]);
  return { ref };
}

export function FolderRow(props: FolderRowProps): preact.JSX.Element {
  const { node } = props;
  const chevron = useIcon('chevronRight', 14);
  const folder = useIcon('folderOutline', 16);
  const more = useIcon('more', 16);
  const isLeaf = node.children.length === 0;

  return (
    <div
      class="xf-row"
      data-depth={node.depth}
      data-active={props.active ? 'true' : 'false'}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onMenu(node, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        class="xf-chevron"
        data-expanded={props.expanded ? 'true' : 'false'}
        data-leaf={isLeaf ? 'true' : 'false'}
        aria-label={props.expanded ? '折叠' : '展开'}
        aria-expanded={props.expanded}
        tabIndex={isLeaf ? -1 : 0}
        onClick={(event) => {
          // Toggling must never also open the folder view.
          event.stopPropagation();
          if (!isLeaf) props.onToggle(node);
        }}
      >
        <span ref={chevron.ref} aria-hidden="true" style="display:inline-flex" />
      </button>

      <span class="xf-row-icon" ref={folder.ref} aria-hidden="true" />

      <button
        type="button"
        class="xf-row-name"
        title={node.name}
        onClick={() => props.onOpen(node)}
        onDblClick={() => props.onBeginRename(node)}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            props.onBeginRename(node);
          }
        }}
      >
        {node.name}
      </button>

      {node.tweetCount > 0 && <span class="xf-row-count">{node.tweetCount}</span>}

      <button
        type="button"
        class="xf-row-more"
        aria-label={`${node.name} 的更多操作`}
        onClick={(event) => {
          event.stopPropagation();
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          props.onMenu(node, rect.left, rect.bottom + 4);
        }}
      >
        <span ref={more.ref} aria-hidden="true" style="display:inline-flex" />
      </button>
    </div>
  );
}
