import { useEffect, useRef } from 'preact/hooks';
import { RECENT_FOLDERS_MAX } from '@/core/constants';
import type { FolderId, FolderTreeNode, FolderWithCount } from '@/core/domain/folder';
import { createIcon, type IconName } from '@/ui/shared/icons';

export interface FolderPickerProps {
  tree: readonly FolderTreeNode[];
  folders: readonly FolderWithCount[];
  recentFolderIds: readonly FolderId[];
  /** Folders the tweet is already saved in. */
  checkedIds: ReadonlySet<FolderId>;
  /** The folder whose save/remove is still in flight, if any. */
  busyId: FolderId | null;
  onSelect: (folderId: FolderId) => void;
  onToggleCollapsed: (node: FolderTreeNode) => void;
}

type ChevronState = 'expanded' | 'collapsed' | 'leaf' | 'none';

function Icon({ name, size }: { name: IconName; size: number }): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon(name, size));
  }, [name, size]);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}

interface PickerRowProps {
  id: FolderId;
  name: string;
  /** Set only in the recent list, where a child folder needs its full path. */
  parentName: string | null;
  depth: number;
  tweetCount: number;
  checked: boolean;
  busy: boolean;
  chevron: ChevronState;
  onToggle: () => void;
  onSelect: () => void;
}

function PickerRow(props: PickerRowProps): preact.JSX.Element {
  const label = props.parentName === null ? props.name : `${props.parentName} / ${props.name}`;
  return (
    <div
      class="xf-row xf-popover-row"
      data-depth={props.depth}
      data-checked={props.checked ? 'true' : 'false'}
      data-busy={props.busy ? 'true' : 'false'}
      data-folder-id={props.id}
    >
      {props.chevron !== 'none' && (
        <button
          type="button"
          class="xf-chevron"
          data-expanded={props.chevron === 'expanded' ? 'true' : 'false'}
          data-leaf={props.chevron === 'leaf' ? 'true' : 'false'}
          aria-label={props.chevron === 'expanded' ? '折叠' : '展开'}
          aria-expanded={props.chevron === 'expanded'}
          tabIndex={props.chevron === 'leaf' ? -1 : 0}
          onClick={(event) => {
            // Expanding must never also save the tweet.
            event.stopPropagation();
            if (props.chevron !== 'leaf') props.onToggle();
          }}
        >
          <Icon name="chevronRight" size={14} />
        </button>
      )}

      <span class="xf-row-icon">
        <Icon name={props.checked ? 'folderFilled' : 'folderOutline'} size={16} />
      </span>

      <button
        type="button"
        class="xf-row-name"
        role="menuitemcheckbox"
        aria-checked={props.checked}
        title={label}
        onClick={props.onSelect}
      >
        {props.parentName !== null && <span class="xf-popover-path">{props.parentName} / </span>}
        <span>{props.name}</span>
      </button>

      {props.tweetCount > 0 && <span class="xf-row-count">{props.tweetCount}</span>}

      {props.checked && (
        <span class="xf-popover-check" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      )}
    </div>
  );
}

/**
 * The two folder lists of the save popover.
 *
 * The recent list is flat and shows a child folder by its full path, because
 *「工作」 out of tree context tells the user nothing about which 「工作」 it is.
 */
export function FolderPicker(props: FolderPickerProps): preact.JSX.Element {
  const byId = new Map(props.folders.map((folder) => [folder.id, folder]));

  const recent = props.recentFolderIds
    // A folder deleted in another tab can still sit in the recent list.
    .map((folderId) => byId.get(folderId))
    .filter((folder): folder is FolderWithCount => folder !== undefined)
    .slice(0, RECENT_FOLDERS_MAX);

  const renderBranch = (node: FolderTreeNode): preact.JSX.Element => {
    const expanded = !node.collapsed;
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id} role="none">
        <PickerRow
          id={node.id}
          name={node.name}
          parentName={null}
          depth={node.depth}
          tweetCount={node.tweetCount}
          checked={props.checkedIds.has(node.id)}
          busy={props.busyId === node.id}
          chevron={hasChildren ? (expanded ? 'expanded' : 'collapsed') : 'leaf'}
          onToggle={() => props.onToggleCollapsed(node)}
          onSelect={() => props.onSelect(node.id)}
        />
        {expanded && hasChildren && (
          <div role="none">{node.children.map((child) => renderBranch(child))}</div>
        )}
      </div>
    );
  };

  return (
    <>
      {recent.length > 0 && (
        <div role="group" aria-label="最近使用">
          <div class="xf-section-title">
            <span>最近使用</span>
          </div>
          {recent.map((folder) => (
            <PickerRow
              key={`recent-${folder.id}`}
              id={folder.id}
              name={folder.name}
              parentName={folder.parentId === null ? null : (byId.get(folder.parentId)?.name ?? null)}
              depth={0}
              tweetCount={folder.tweetCount}
              checked={props.checkedIds.has(folder.id)}
              busy={props.busyId === folder.id}
              chevron="none"
              onToggle={() => {}}
              onSelect={() => props.onSelect(folder.id)}
            />
          ))}
        </div>
      )}

      <div role="group" aria-label="全部文件夹">
        <div class="xf-section-title">
          <span>全部文件夹</span>
        </div>
        {props.tree.map((node) => renderBranch(node))}
      </div>
    </>
  );
}
