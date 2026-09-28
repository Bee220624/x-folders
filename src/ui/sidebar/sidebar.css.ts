export const SIDEBAR_CSS = `
.xf-sidebar {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* The whole block, header included, fits in what X leaves free. */
  max-height: var(--xf-sidebar-max-height, none);
  padding: 8px 0 12px;
  border-top: 1px solid var(--xf-border);
}
:host([data-xf-mode="narrow"]) .xf-sidebar { padding: 2px 0; border-top: 0; }
.xf-tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.xf-tree::-webkit-scrollbar { width: 6px; }
.xf-tree::-webkit-scrollbar-thumb { background: var(--xf-border); border-radius: 3px; }

.xf-row[data-depth="1"] { padding-left: 18px; }
.xf-row-more {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--xf-text-muted);
}
.xf-row:hover .xf-row-more, .xf-row-more:focus-visible { display: inline-flex; }
.xf-row-more:hover { background: var(--xf-hover); color: var(--xf-accent); }
.xf-row-icon { flex: 0 0 auto; display: inline-flex; color: var(--xf-text-muted); }
.xf-row[data-active="true"] .xf-row-icon { color: var(--xf-accent); }

.xf-editor { padding: 4px 6px 4px 24px; }

.xf-narrow-layer { position: fixed; inset: 0; z-index: 4; }
.xf-menu-layer { position: fixed; inset: 0; z-index: 6; }
.xf-menu-anchored { position: absolute; }

/* Narrow-sidebar mode: a nav-sized icon button plus a floating panel. */
.xf-narrow-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  margin: 2px 0;
  border-radius: 9999px;
  color: var(--xf-text);
}
.xf-narrow-button:hover { background: var(--xf-hover); }
.xf-narrow-panel {
  position: fixed;
  width: 260px;
  max-height: 60vh;
  overflow: hidden;
  padding: 8px 4px;
  border-radius: 16px;
  background: var(--xf-bg-elevated);
  border: 1px solid var(--xf-border);
  box-shadow: var(--xf-shadow);
  z-index: 5;
}
`;
