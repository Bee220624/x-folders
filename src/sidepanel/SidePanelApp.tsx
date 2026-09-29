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
 * The side panel: the same folder tree and folder list the page uses, stacked.
 * Opening a post is routed to the X tab beside the panel (see openPost).
 */
export function SidePanelApp(props: SidePanelAppProps): preact.JSX.Element {
  const [folderId, setFolderId] = useState<FolderId | null>(null);

  useEffect(() => {
    void props.store.refresh();
  }, [props.store]);

  return (
    <div class="xf-root xf-sp">
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
            onOpenPost={(url, options) => void openPost(url, options)}
          />
        )}
      </div>
    </div>
  );
}
