import type { FolderId, FolderTreeNode } from '@/core/domain/folder';
import { FolderRow } from './FolderRow';
import { InlineNameEditor } from './InlineNameEditor';

export interface FolderTreeProps {
  nodes: readonly FolderTreeNode[];
  activeFolderId: FolderId | null;
  renamingId: FolderId | null;
  creatingUnder: FolderId | null | undefined;
  onToggle: (node: FolderTreeNode) => void;
  onOpen: (node: FolderTreeNode) => void;
  onMenu: (node: FolderTreeNode, x: number, y: number) => void;
  onBeginRename: (node: FolderTreeNode) => void;
  onCommitRename: (node: FolderTreeNode, name: string) => Promise<string | null>;
  onCommitCreate: (parentId: FolderId | null, name: string) => Promise<string | null>;
  onCancelEdit: () => void;
}

/**
 * Renders the tree recursively. The two-level limit is a domain rule enforced in
 * the service layer, not a UI shape — this component would render any depth,
 * which is what keeps the constraint in exactly one place.
 */
export function FolderTree(props: FolderTreeProps): preact.JSX.Element {
  return (
    <div role="tree" aria-label="我的收藏">
      {props.nodes.map((node) => (
        <FolderBranch key={node.id} node={node} {...props} />
      ))}
    </div>
  );
}

function FolderBranch({
  node,
  ...props
}: FolderTreeProps & { node: FolderTreeNode }): preact.JSX.Element {
  const expanded = !node.collapsed;
  const isRenaming = props.renamingId === node.id;
  const isCreatingChild = props.creatingUnder === node.id;

  return (
    <div role="treeitem" aria-expanded={node.children.length > 0 ? expanded : undefined}>
      {isRenaming ? (
        <div class="xf-editor">
          <InlineNameEditor
            initialValue={node.name}
            placeholder="文件夹名称"
            onCommit={(name) => props.onCommitRename(node, name)}
            onCancel={props.onCancelEdit}
          />
        </div>
      ) : (
        <FolderRow
          node={node}
          active={props.activeFolderId === node.id}
          expanded={expanded}
          onToggle={props.onToggle}
          onOpen={props.onOpen}
          onMenu={props.onMenu}
          onBeginRename={props.onBeginRename}
        />
      )}

      {isCreatingChild && (
        <div class="xf-editor" style="padding-left:36px">
          <InlineNameEditor
            initialValue=""
            placeholder="子文件夹名称"
            onCommit={(name) => props.onCommitCreate(node.id, name)}
            onCancel={props.onCancelEdit}
          />
        </div>
      )}

      {expanded && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <FolderBranch key={child.id} node={child} {...props} />
          ))}
        </div>
      )}
    </div>
  );
}
