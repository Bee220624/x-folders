export const SAVE_POPOVER_CSS = `
.xf-popover {
  display: flex;
  flex-direction: column;
  width: 268px;
  max-height: min(60vh, 420px);
  padding: 8px 0 6px;
  border-radius: 16px;
  background: var(--xf-bg-elevated);
  border: 1px solid var(--xf-border);
  box-shadow: var(--xf-shadow);
}
.xf-popover-title {
  padding: 0 12px 6px;
  font-size: 15px;
  font-weight: 800;
}
.xf-popover-scroll {
  flex: 1 1 auto;
  padding: 0 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.xf-popover-scroll::-webkit-scrollbar { width: 6px; }
.xf-popover-scroll::-webkit-scrollbar-thumb { background: var(--xf-border); border-radius: 3px; }

.xf-popover-row[data-depth="1"] { padding-left: 18px; }
.xf-popover-row[data-busy="true"] { opacity: .5; pointer-events: none; }
.xf-popover-row .xf-row-icon { flex: 0 0 auto; display: inline-flex; color: var(--xf-text-muted); }
.xf-popover-row[data-checked="true"] .xf-row-icon { color: var(--xf-accent); }
.xf-popover-check { flex: 0 0 auto; display: inline-flex; color: var(--xf-accent); }
/* The parent segment of a 「父 / 子」 path recedes so the leaf name reads first. */
.xf-popover-path { color: var(--xf-text-muted); }

.xf-popover-footer {
  flex: 0 0 auto;
  margin-top: 4px;
  padding: 6px 6px 0;
  border-top: 1px solid var(--xf-border);
}
.xf-popover-new {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 14px;
  text-align: left;
  color: var(--xf-accent);
}
.xf-popover-new:hover { background: var(--xf-hover); }
`;
