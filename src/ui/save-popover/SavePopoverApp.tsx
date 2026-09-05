import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FolderId, FolderTreeNode } from '@/core/domain/folder';
import type { TweetId, TweetRecord } from '@/core/domain/tweet';
import { messageFor } from '@/core/errors/DomainError';
import { rpc } from '@/messaging/RpcClient';
import type { FolderStore, FolderStoreState } from '@/state/FolderStore';
import { createIcon } from '@/ui/shared/icons';
import { toasts } from '@/ui/shared/toastStore';
import { InlineNameEditor } from '@/ui/sidebar/InlineNameEditor';
import { FolderPicker } from './FolderPicker';

export interface SavePopoverAppProps {
  store: FolderStore;
  tweetId: TweetId;
  /** Resolved per click: X can recycle the card between opening and choosing. */
  resolveTweet: () => TweetRecord | null;
  onMembershipChanged: (membershipCount: number) => void;
  onRequestClose: () => void;
}

function useStore(store: FolderStore): FolderStoreState {
  const [state, setState] = useState<FolderStoreState>(store.state);
  useEffect(() => store.subscribe(setState), [store]);
  return state;
}

function PlusIcon(): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon('plus', 16));
  }, []);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}

/**
 * The popover body: which folders hold this tweet, and one click to change that.
 *
 * No `ToastHost` is rendered here on purpose. A successful save closes the
 * popover immediately, so a toast owned by this shadow root would be torn down
 * before it could be read; the toast store is a singleton and the surfaces that
 * outlive the popover render it instead.
 */
export function SavePopoverApp(props: SavePopoverAppProps): preact.JSX.Element {
  const state = useStore(props.store);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<FolderId>>(new Set());
  const [busyId, setBusyId] = useState<FolderId | null>(null);
  const [creating, setCreating] = useState(false);

  /**
   * Unmount invalidates every request still in flight, so a response that lands
   * after the popover closed cannot toast, re-render or move the action button.
   */
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  useEffect(() => {
    const ticket = generation.current;
    void props.store.refresh();
    void (async () => {
      const result = await rpc('memberships.getForTweet', { tweetId: props.tweetId });
      if (ticket !== generation.current) return;
      if (!result.ok) {
        toasts.show(messageFor(result.error.code), { tone: 'danger' });
        return;
      }
      setCheckedIds(new Set(result.data));
    })();
  }, [props.store, props.tweetId]);

  const save = useCallback(
    async (folderId: FolderId, name: string): Promise<void> => {
      const tweet = props.resolveTweet();
      if (tweet === null) {
        toasts.show(messageFor('INVALID_TWEET_ID'), { tone: 'danger' });
        props.onRequestClose();
        return;
      }
      const ticket = generation.current;
      setBusyId(folderId);
      const result = await rpc('memberships.saveTweet', { folderId, tweet });
      if (ticket !== generation.current) return;
      setBusyId(null);
      if (!result.ok) {
        toasts.show(messageFor(result.error.code), { tone: 'danger' });
        return;
      }
      props.onMembershipChanged(result.data.membershipCount);
      toasts.show(`已保存到 ${name}`);
      props.onRequestClose();
    },
    [props],
  );

  const remove = useCallback(
    async (folderId: FolderId, name: string): Promise<void> => {
      const ticket = generation.current;
      setBusyId(folderId);
      const result = await rpc('memberships.removeTweet', { folderId, tweetId: props.tweetId });
      if (ticket !== generation.current) return;
      setBusyId(null);
      if (!result.ok) {
        toasts.show(messageFor(result.error.code), { tone: 'danger' });
        return;
      }
      props.onMembershipChanged(result.data.membershipCount);
      toasts.show(`已从 ${name} 移除`);
      props.onRequestClose();
    },
    [props],
  );

  const select = useCallback(
    (folderId: FolderId): void => {
      if (busyId !== null) return;
      const name = props.store.findFolder(folderId)?.name;
      if (name === undefined) return;
      if (checkedIds.has(folderId)) void remove(folderId, name);
      else void save(folderId, name);
    },
    [busyId, checkedIds, props.store, remove, save],
  );

  const toggleCollapsed = useCallback(
    async (node: FolderTreeNode): Promise<void> => {
      await rpc('folders.setCollapsed', { folderId: node.id, collapsed: !node.collapsed });
      await props.store.refresh();
    },
    [props.store],
  );

  const commitCreate = useCallback(
    async (name: string): Promise<string | null> => {
      const ticket = generation.current;
      const result = await rpc('folders.create', { name, parentId: null });
      if (ticket !== generation.current) return null;
      if (!result.ok) return messageFor(result.error.code);
      setCreating(false);
      await props.store.refresh();
      if (ticket !== generation.current) return null;
      // Creating a folder from here is one gesture with saving into it.
      await save(result.data.id, result.data.name);
      return null;
    },
    [props.store, save],
  );

  const body = state.loading ? (
    <div class="xf-empty">载入中…</div>
  ) : state.folders.length === 0 ? (
    <div class="xf-empty">还没有文件夹，新建一个吧。</div>
  ) : (
    <FolderPicker
      tree={state.tree}
      folders={state.folders}
      recentFolderIds={state.recentFolderIds}
      checkedIds={checkedIds}
      busyId={busyId}
      onSelect={select}
      onToggleCollapsed={(node) => void toggleCollapsed(node)}
    />
  );

  return (
    <div class="xf-popover" role="dialog" aria-label="保存到文件夹">
      <div class="xf-popover-title">保存到</div>
      <div class="xf-popover-scroll" role="menu" aria-label="文件夹列表">
        {body}
      </div>
      <div class="xf-popover-footer">
        {creating ? (
          <InlineNameEditor
            initialValue=""
            placeholder="文件夹名称"
            onCommit={commitCreate}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button type="button" class="xf-popover-new" onClick={() => setCreating(true)}>
            <PlusIcon />
            <span>新建文件夹</span>
          </button>
        )}
      </div>
    </div>
  );
}
