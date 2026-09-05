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

.xf-fv-row {
  display: flex;
  align-items: flex-start;
  border-bottom: 1px solid var(--xf-border);
}
.xf-fv-row:hover { background: var(--xf-hover); }
.xf-fv-card {
  flex: 1 1 auto;
  min-width: 0;
  display: block;
  padding: 12px;
  color: inherit;
  text-decoration: none;
}
.xf-fv-meta { display: flex; align-items: baseline; gap: 6px; }
.xf-fv-author {
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xf-fv-handle {
  font-size: 14px;
  color: var(--xf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xf-fv-time {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--xf-text-muted);
  white-space: nowrap;
}
.xf-fv-open { flex: 0 0 auto; display: inline-flex; color: var(--xf-text-muted); }
.xf-fv-card:hover .xf-fv-open { color: var(--xf-accent); }
.xf-fv-text {
  margin: 4px 0 0;
  font-size: 15px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.xf-fv-text[data-empty="true"] { color: var(--xf-text-muted); }

.xf-fv-remove {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: 10px 8px 0 0;
  border-radius: 9999px;
  color: var(--xf-text-muted);
}
.xf-fv-remove:hover:not([disabled]) { background: var(--xf-accent-soft); color: var(--xf-danger); }
.xf-fv-remove[disabled] { opacity: .45; cursor: default; }

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
