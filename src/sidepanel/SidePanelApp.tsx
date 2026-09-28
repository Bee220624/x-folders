import { useEffect, useState } from 'preact/hooks';
import type { FolderId } from '@/core/domain/folder';
import type { FolderStore } from '@/state/FolderStore';
import { FolderViewApp } from '@/ui/folder-view/FolderViewApp';
import { SidebarApp } from '@/ui/sidebar/SidebarApp';
import { openPost } from './openPost';

export interface SidePanelAppProps {
  store: FolderStore;
}

/**
 * M1 side panel: the same folder tree and folder list the page uses, stacked.
 * Clicks on a post are routed to the X tab instead of navigating the panel.
 */
export function SidePanelApp(props: SidePanelAppProps): preact.JSX.Element {
  const [folderId, setFolderId] = useState<FolderId | null>(null);

  useEffect(() => {
    void props.store.refresh();
  }, [props.store]);

  return (
    <div class="xf-root xf-sp" onClick={routePostLinks}>
      <div class="xf-sp-tree">
        <SidebarApp store={props.store} mode="wide" onOpenFolder={setFolderId} />
      </div>
      <div class="xf-sp-view">
        {folderId === null ? (
          <div class="xf-fv-state">选择一个文件夹查看收藏。</div>
        ) : (
          <FolderViewApp
            store={props.store}
            folderId={folderId}
            onClose={() => setFolderId(null)}
            onMembershipChanged={() => {}}
          />
        )}
      </div>
    </div>
  );
}

function routePostLinks(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  void openPost(anchor.href, { newTab: event.metaKey || event.ctrlKey });
}
