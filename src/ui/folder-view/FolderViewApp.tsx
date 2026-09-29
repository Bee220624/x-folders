import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { FOLDER_TWEETS_PAGE_SIZE } from '@/core/constants';
import type { FolderId } from '@/core/domain/folder';
import type { FolderTweetsCursor, SavedTweetView } from '@/core/domain/membership';
import type { TweetId } from '@/core/domain/tweet';
import { messageFor } from '@/core/errors/DomainError';
import type { ListFolderTweetsPayload } from '@/messaging/protocol';
import { rpc } from '@/messaging/RpcClient';
import type { FolderStore, FolderStoreState } from '@/state/FolderStore';
import { createIcon } from '@/ui/shared/icons';
import { ToastHost } from '@/ui/shared/Toast';
import { toasts } from '@/ui/shared/toastStore';
import { FolderContextMenu } from '@/ui/sidebar/FolderContextMenu';
import type { OpenOptions } from '@/ui/tweet-card/TweetCard';
import { SavedTweetCard } from './SavedTweetCard';

/** How close to the bottom the reader must get before the next page is asked for. */
const PREFETCH_PX = 320;

export interface FolderViewAppProps {
  store: FolderStore;
  folderId: FolderId;
  onClose: () => void;
  onMembershipChanged: (tweetId: TweetId, membershipCount: number) => void;
  /** Present only on the page overlay: hands the reading over to the side panel. */
  onOpenInSidePanel?: () => void;
  /** Opens a post from a card: the page navigates itself, the side panel asks the X tab. */
  onOpenPost: (url: string, options: OpenOptions) => void;
}

type ListStatus = 'loading' | 'ready' | 'error';

function useStore(store: FolderStore): FolderStoreState {
  const [state, setState] = useState<FolderStoreState>(store.state);
  useEffect(() => store.subscribe(setState), [store]);
  return state;
}

function CloseIcon(): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon('close', 20));
  }, []);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}

function SidePanelIcon(): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(createIcon('sidePanel', 20));
  }, []);
  return <span ref={ref} aria-hidden="true" style="display:inline-flex" />;
}

export function FolderViewApp(props: FolderViewAppProps): preact.JSX.Element {
  const state = useStore(props.store);
  const folder = state.folders.find((candidate) => candidate.id === props.folderId);
  const storeCount = folder?.tweetCount;

  const [items, setItems] = useState<SavedTweetView[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [removing, setRemoving] = useState<TweetId | null>(null);
  const [count, setCount] = useState<number>(storeCount ?? 0);
  const [menu, setMenu] = useState<{ tweetId: TweetId; x: number; y: number } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<FolderTweetsCursor | null>(null);
  const inFlight = useRef(false);
  /**
   * Bumped on every folder switch and on unmount. Same trick as
   * `FolderStore.refresh`: a page that resolves after its view is gone is
   * dropped instead of repopulating a destroyed or already-switched list.
   */
  const generation = useRef(0);

  const loadPage = useCallback(
    async (reset: boolean): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      const ticket = generation.current;

      if (reset) {
        setStatus('loading');
        setError(null);
      } else {
        setLoadingMore(true);
        setMoreError(null);
      }

      const cursor = reset ? null : cursorRef.current;
      const payload: ListFolderTweetsPayload =
        cursor === null
          ? { folderId: props.folderId, limit: FOLDER_TWEETS_PAGE_SIZE }
          : { folderId: props.folderId, limit: FOLDER_TWEETS_PAGE_SIZE, cursor };
      const result = await rpc('memberships.listFolderTweets', payload);

      // The reset below owns `inFlight` for a superseded generation, so this
      // path deliberately leaves it alone.
      if (ticket !== generation.current) return;
      inFlight.current = false;

      if (!result.ok) {
        const message = messageFor(result.error.code);
        if (reset) {
          setStatus('error');
          setError(message);
        } else {
          // Rows already on screen stay put; only the footer reports the failure.
          setMoreError(message);
        }
        setLoadingMore(false);
        return;
      }

      const page = result.data;
      setItems((previous) => (reset ? page.items : [...previous, ...page.items]));
      cursorRef.current = page.nextCursor;
      setExhausted(page.nextCursor === null);
      setStatus('ready');
      setLoadingMore(false);
    },
    [props.folderId],
  );

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    cursorRef.current = null;
    setItems([]);
    setStatus('loading');
    setError(null);
    setMoreError(null);
    setLoadingMore(false);
    setExhausted(false);
    setRemoving(null);
    setMenu(null);
    void loadPage(true);
    return () => {
      generation.current += 1;
    };
  }, [props.folderId, loadPage]);

  // The store's snapshot is authoritative; the local decrement in `remove`
  // keeps the header honest between a removal and the next refresh.
  useEffect(() => {
    setCount(storeCount ?? 0);
  }, [storeCount, props.folderId]);

  const loadMore = useCallback((): void => {
    if (inFlight.current || exhausted || status !== 'ready' || moreError !== null) return;
    void loadPage(false);
  }, [exhausted, loadPage, moreError, status]);

  const onScroll = useCallback((): void => {
    const list = listRef.current;
    if (list === null) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight > PREFETCH_PX) return;
    loadMore();
  }, [loadMore]);

  const remove = useCallback(
    async (tweetId: TweetId): Promise<void> => {
      const ticket = generation.current;
      setRemoving(tweetId);
      const result = await rpc('memberships.removeTweet', {
        folderId: props.folderId,
        tweetId,
      });
      if (ticket !== generation.current) return;
      setRemoving(null);

      if (!result.ok) {
        toasts.show(messageFor(result.error.code), { tone: 'danger' });
        return;
      }
      // Splicing the row out keeps both the reader's scroll position and the
      // pagination cursor valid; refetching the list would lose both.
      setItems((previous) => previous.filter((item) => item.tweet.tweetId !== tweetId));
      setCount((previous) => Math.max(0, previous - 1));
      props.onMembershipChanged(tweetId, result.data.membershipCount);
      props.store.scheduleRefresh();
      toasts.show('已从文件夹移除');
    },
    [props],
  );

  const now = Date.now();
  const name = folder?.name ?? '收藏';

  let body: preact.JSX.Element;
  if (status === 'loading' && items.length === 0) {
    body = <div class="xf-fv-state">载入中…</div>;
  } else if (status === 'error') {
    body = (
      <div class="xf-fv-state" data-tone="danger" role="alert">
        <span>{error ?? messageFor('UNKNOWN')}</span>
        <button type="button" class="xf-fv-retry" onClick={() => void loadPage(true)}>
          重试
        </button>
      </div>
    );
  } else if (items.length === 0) {
    body = <div class="xf-fv-state">这个文件夹还没有收藏的帖子。</div>;
  } else {
    body = (
      <>
        {items.map((item) => (
          <SavedTweetCard
            key={item.tweet.tweetId}
            item={item}
            now={now}
            removing={removing === item.tweet.tweetId}
            onOpen={props.onOpenPost}
            onMenu={(tweetId, x, y) => setMenu({ tweetId, x, y })}
          />
        ))}
        {loadingMore && <div class="xf-fv-footer">载入中…</div>}
        {moreError !== null && (
          <div class="xf-fv-footer" role="alert">
            <span>{moreError}</span>
            <button
              type="button"
              class="xf-fv-retry"
              onClick={() => {
                setMoreError(null);
                void loadPage(false);
              }}
            >
              重试
            </button>
          </div>
        )}
        {exhausted && !loadingMore && moreError === null && (
          <div class="xf-fv-footer">没有更多了</div>
        )}
      </>
    );
  }

  const menuTarget = menu === null ? undefined : items.find((item) => item.tweet.tweetId === menu.tweetId);

  return (
    <div class="xf-fv">
      <header class="xf-fv-header">
        <button
          type="button"
          class="xf-icon-button"
          aria-label="关闭文件夹"
          title="关闭文件夹"
          onClick={props.onClose}
        >
          <CloseIcon />
        </button>
        <div class="xf-fv-title">
          <span class="xf-fv-name" title={name}>
            {name}
          </span>
          <span class="xf-fv-count">{`${count} 条收藏`}</span>
        </div>
        {props.onOpenInSidePanel !== undefined && (
          <button
            type="button"
            class="xf-icon-button xf-fv-side-panel"
            aria-label="在侧边栏中打开"
            title="在侧边栏中打开"
            onClick={props.onOpenInSidePanel}
          >
            <SidePanelIcon />
          </button>
        )}
      </header>

      <div class="xf-fv-list" ref={listRef} onScroll={onScroll}>
        {body}
      </div>

      {menu !== null && menuTarget !== undefined && (
        <FolderContextMenu
          items={[
            { id: 'open', label: '在新标签页打开', icon: 'external' },
            { id: 'remove', label: '从此文件夹移除', icon: 'trash', danger: true, disabled: removing !== null },
          ]}
          x={menu.x}
          y={menu.y}
          onSelect={(action) => {
            setMenu(null);
            if (action === 'open') props.onOpenPost(menuTarget.tweet.canonicalUrl, { newTab: true });
            if (action === 'remove') void remove(menuTarget.tweet.tweetId);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      <ToastHost />
    </div>
  );
}
