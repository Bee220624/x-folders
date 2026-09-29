/**
 * Folder-view shadow CSS. Like every other surface it is a string injected into
 * the view's own shadow root, and every colour comes from a `--xf-*` token.
 */
export const FOLDER_VIEW_CSS = `
/* The host is sized to X's primary column by FolderViewMount; the tree inside
   simply fills it. */
.xf-root { height: 100%; }

.xf-fv {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--xf-bg);
  border-left: 1px solid var(--xf-border);
  border-right: 1px solid var(--xf-border);
}

.xf-fv-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 53px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--xf-border);
}
.xf-fv-title { display: flex; flex-direction: column; min-width: 0; }
.xf-fv-side-panel { margin-left: auto; }
.xf-fv-name {
  font-size: 17px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xf-fv-count { font-size: 13px; color: var(--xf-text-muted); font-variant-numeric: tabular-nums; }

.xf-fv-list {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.xf-fv-list::-webkit-scrollbar { width: 6px; }
.xf-fv-list::-webkit-scrollbar-thumb { background: var(--xf-border); border-radius: 3px; }

.xf-fv-row { border-bottom: 1px solid var(--xf-border); }
.xf-fv-row:hover { background: var(--xf-hover); }
.xf-fv-row[data-removing="true"] { opacity: .5; }

/* The ⋯ menu (FolderContextMenu) floats over the list. */
.xf-menu-layer { position: fixed; inset: 0; z-index: 6; }
.xf-menu-anchored { position: absolute; }

.xf-fv-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 12px;
  font-size: 13px;
  color: var(--xf-text-muted);
}
.xf-fv-retry {
  font-size: 13px;
  font-weight: 700;
  color: var(--xf-accent);
  text-decoration: underline;
}
.xf-fv-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 24px;
  font-size: 14px;
  color: var(--xf-text-muted);
  text-align: center;
}
.xf-fv-state[data-tone="danger"] { color: var(--xf-danger); }
`;
