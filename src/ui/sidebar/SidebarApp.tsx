import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { MAX_FOLDER_DEPTH } from '@/core/constants';
import type { FolderId, FolderTreeNode } from '@/core/domain/folder';
import { messageFor } from '@/core/errors/DomainError';
import { rpc } from '@/messaging/RpcClient';
import type { FolderStore, FolderStoreState } from '@/state/FolderStore';
import { ConfirmDialog } from '@/ui/shared/ConfirmDialog';
import { ToastHost } from '@/ui/shared/Toast';
import { toasts } from '@/ui/shared/toastStore';
import { createIcon } from '@/ui/shared/icons';
import { FolderContextMenu, type MenuItem } from './FolderContextMenu';
import { FolderTree } from './FolderTree';
import { InlineNameEditor } from './InlineNameEditor';

export interface SidebarAppProps {
  store: FolderStore;
  mode: 'wide' | 'narrow';
  onOpenFolder: (folderId: FolderId) => void;
}

interface MenuState {
  node: FolderTreeNode;
  x: number;
  y: number;
}

interface ConfirmState {
  folderId: FolderId;
  title: string;
  body: string;
}

function useStore(store: FolderStore): FolderStoreState {
  const [state, setState] = useState<FolderStoreState>(store.state);
  useEffect(() => store.subscribe(setState), [store]);
  return state;
}

function IconSpan({ name, size }: { name: 'plus' | 'folderOutline'; size: number }): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon(name, size));
  }, [name, size]);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}

export function SidebarApp(props: SidebarAppProps): preact.JSX.Element {
  const state = useStore(props.store);
  const [renamingId, setRenamingId] = useState<FolderId | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<FolderId | null | undefined>(undefined);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    void props.store.refresh();
  }, [props.store]);

  const clearEditing = useCallback(() => {
    setRenamingId(null);
    setCreatingUnder(undefined);
  }, []);

  /** Only one editor may exist at a time; opening one closes the other. */
  const beginRename = useCallback((node: FolderTreeNode) => {
    setCreatingUnder(undefined);
    setRenamingId(node.id);
  }, []);

  const beginCreate = useCallback((parentId: FolderId | null) => {
    setRenamingId(null);
    setCreatingUnder(parentId);
  }, []);

  const commitCreate = useCallback(
    async (parentId: FolderId | null, name: string): Promise<string | null> => {
      const result = await rpc('folders.create', { name, parentId });
      if (!result.ok) {
        // A create is never retried, so a lost response may still have
        // committed. Resync so the tree shows whatever actually landed.
        await props.store.refresh();
        return messageFor(result.error.code);
      }
      clearEditing();
      if (parentId !== null) {
        // A new child in a collapsed parent would otherwise appear to do nothing.
        await rpc('folders.setCollapsed', { folderId: parentId, collapsed: false });
      }
      await props.store.refresh();
      return null;
    },
    [clearEditing, props.store],
  );

  const commitRename = useCallback(
    async (node: FolderTreeNode, name: string): Promise<string | null> => {
      const result = await rpc('folders.rename', { folderId: node.id, name });
      if (!result.ok) return messageFor(result.error.code);
      clearEditing();
      await props.store.refresh();
      return null;
    },
    [clearEditing, props.store],
  );

  const toggle = useCallback(
    async (node: FolderTreeNode): Promise<void> => {
      await rpc('folders.setCollapsed', { folderId: node.id, collapsed: !node.collapsed });
      await props.store.refresh();
    },
    [props.store],
  );

  const openFolder = useCallback(
    (node: FolderTreeNode) => {
      props.store.setActiveFolder(node.id);
      props.onOpenFolder(node.id);
      setPanelOpen(false);
    },
    [props],
  );

  const runMenuAction = useCallback(
    async (node: FolderTreeNode, action: string): Promise<void> => {
      setMenu(null);
      switch (action) {
        case 'new-child':
          beginCreate(node.id);
          return;
        case 'rename':
          beginRename(node);
          return;
        case 'up':
        case 'down': {
          const result = await rpc(action === 'up' ? 'folders.moveUp' : 'folders.moveDown', {
            folderId: node.id,
          });
          if (!result.ok) toasts.show(messageFor(result.error.code), { tone: 'danger' });
          await props.store.refresh();
          return;
        }
        case 'delete': {
          const preview = await rpc('folders.deletePreview', { folderId: node.id });
          if (!preview.ok) {
            toasts.show(messageFor(preview.error.code), { tone: 'danger' });
            return;
          }
          const { name, descendantCount, membershipCount } = preview.data;
          setConfirm({
            folderId: node.id,
            title: `删除「${name}」？`,
            body:
              `这将删除该文件夹${descendantCount > 0 ? `及其 ${descendantCount} 个子文件夹` : ''}` +
              `，以及其中的 ${membershipCount} 条收藏记录。\n\n` +
              '同一条帖子保存在其他文件夹中的记录不会受影响。',
          });
          return;
        }
        default:
          return;
      }
    },
    [beginCreate, beginRename, props.store],
  );

  const doDelete = useCallback(async (): Promise<void> => {
    if (confirm === null) return;
    const target = confirm.folderId;
    setConfirm(null);
    const result = await rpc('folders.delete', { folderId: target });
    if (!result.ok) {
      toasts.show(messageFor(result.error.code), { tone: 'danger' });
      // Same reasoning as create: the delete is not retried, so resync rather
      // than leaving the tree showing a folder that may already be gone.
      await props.store.refresh();
      return;
    }
    toasts.show('文件夹已删除');
    await props.store.refresh();
  }, [confirm, props.store]);

  const menuItems = (node: FolderTreeNode): MenuItem[] => {
    const siblings =
      node.parentId === null
        ? state.tree
        : (state.tree.find((root) => root.id === node.parentId)?.children ?? []);
    const index = siblings.findIndex((sibling) => sibling.id === node.id);
    const items: MenuItem[] = [];
    // Hidden rather than disabled at max depth; the service validates regardless.
    if (node.depth < MAX_FOLDER_DEPTH - 1) {
      items.push({ id: 'new-child', label: '新建子文件夹', icon: 'plus' });
    }
    items.push({ id: 'rename', label: '重命名', icon: 'folderOutline' });
    items.push({ id: 'up', label: '上移', icon: 'chevronRight', disabled: index <= 0 });
    items.push({
      id: 'down',
      label: '下移',
      icon: 'chevronRight',
      disabled: index < 0 || index >= siblings.length - 1,
    });
    items.push({ id: 'delete', label: '删除', icon: 'trash', danger: true });
    return items;
  };

  const tree = (
    <div class="xf-tree">
      {creatingUnder === null && (
        <div class="xf-editor">
          <InlineNameEditor
            initialValue=""
            placeholder="文件夹名称"
            onCommit={(name) => commitCreate(null, name)}
            onCancel={clearEditing}
          />
        </div>
      )}
      {state.loading ? (
        <div class="xf-empty">载入中…</div>
      ) : state.tree.length === 0 && creatingUnder !== null ? (
        <div class="xf-empty">还没有文件夹。点击右上角 ＋ 新建一个。</div>
      ) : (
        <FolderTree
          nodes={state.tree}
          activeFolderId={state.activeFolderId}
          renamingId={renamingId}
          creatingUnder={creatingUnder}
          onToggle={(node) => void toggle(node)}
          onOpen={openFolder}
          onMenu={(node, x, y) => setMenu({ node, x, y })}
          onBeginRename={beginRename}
          onCommitRename={commitRename}
          onCommitCreate={commitCreate}
          onCancelEdit={clearEditing}
        />
      )}
    </div>
  );

  const header = (
    <div class="xf-section-title">
      <span>我的收藏</span>
      <button
        type="button"
        class="xf-icon-button"
        aria-label="新建文件夹"
        title="新建文件夹"
        onClick={() => beginCreate(null)}
      >
        <IconSpan name="plus" size={18} />
      </button>
    </div>
  );

  const overlays = (
    <>
      {menu !== null && (
        <FolderContextMenu
          items={menuItems(menu.node)}
          x={menu.x}
          y={menu.y}
          onSelect={(action) => void runMenuAction(menu.node, action)}
          onClose={() => setMenu(null)}
        />
      )}
      {confirm !== null && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirm(null)}
        />
      )}
      <ToastHost />
    </>
  );

  if (props.mode === 'narrow') {
    return (
      <div class="xf-sidebar">
        <button
          type="button"
          class="xf-narrow-button"
          aria-label="我的收藏"
          aria-expanded={panelOpen}
          title="我的收藏"
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setPanelPos({ left: rect.right + 8, top: Math.max(8, rect.top - 120) });
            setPanelOpen((open) => !open);
          }}
        >
          <IconSpan name="folderOutline" size={26} />
        </button>
        {panelOpen && (
          <>
            {/* Its own layer, below the context menu and the delete dialog: sharing
                theirs let this one cover them and swallow their first click. */}
            <div class="xf-narrow-layer" onClick={() => setPanelOpen(false)} />
            <div
              class="xf-narrow-panel"
              style={`left:${panelPos.left}px;top:${panelPos.top}px`}
            >
              {header}
              {tree}
            </div>
          </>
        )}
        {overlays}
      </div>
    );
  }

  return (
    <div class="xf-sidebar">
      {header}
      {tree}
      {overlays}
    </div>
  );
}
