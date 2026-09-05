/**
 * Shared shadow-root CSS, exported as a string rather than imported as a `.css`
 * file. Every UI surface injects it into its own shadow root, so nothing ever
 * reaches x.com's document and the styles are equally available in jsdom tests
 * without a build step.
 *
 * All colours come from the `--xf-*` variables written onto the host element by
 * ThemeAdapter. Never reference an X class name here.
 */
export const BASE_CSS = `
:host {
  all: initial;
  font-family: var(--xf-font-family);
  color: var(--xf-text);
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
.xf-root { font-family: var(--xf-font-family); font-size: 15px; line-height: 1.4; color: var(--xf-text); }

button, input {
  font: inherit;
  color: inherit;
  margin: 0;
}
button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
button:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--xf-accent);
  outline-offset: 1px;
  border-radius: 4px;
}

.xf-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px 4px 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--xf-text-muted);
  letter-spacing: .02em;
}
.xf-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  color: var(--xf-text-muted);
}
.xf-icon-button:hover { background: var(--xf-hover); color: var(--xf-accent); }

.xf-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 32px;
  padding: 2px 6px 2px 0;
  border-radius: 8px;
  color: var(--xf-text);
}
.xf-row:hover { background: var(--xf-hover); }
.xf-row[data-active="true"] { background: var(--xf-accent-soft); color: var(--xf-accent); }
.xf-row-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 14px;
}
.xf-row-count {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--xf-text-muted);
  font-variant-numeric: tabular-nums;
}
.xf-chevron {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--xf-text-muted);
  border-radius: 4px;
  transition: transform .12s ease;
}
.xf-chevron[data-expanded="true"] { transform: rotate(90deg); }
.xf-chevron[data-leaf="true"] { visibility: hidden; }

.xf-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--xf-accent);
  border-radius: 8px;
  background: var(--xf-bg);
  color: var(--xf-text);
  font-size: 14px;
  outline: none;
}
.xf-error {
  padding: 2px 8px 6px;
  font-size: 12px;
  color: var(--xf-danger);
}
.xf-empty {
  padding: 16px 12px;
  font-size: 14px;
  color: var(--xf-text-muted);
  text-align: center;
}

.xf-menu {
  min-width: 168px;
  padding: 6px 0;
  border-radius: 12px;
  background: var(--xf-bg-elevated);
  box-shadow: var(--xf-shadow);
  border: 1px solid var(--xf-border);
}
.xf-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 14px;
  font-size: 14px;
  text-align: left;
  color: var(--xf-text);
}
.xf-menu-item:hover:not([disabled]) { background: var(--xf-hover); }
.xf-menu-item[disabled] { opacity: .45; cursor: default; }
.xf-menu-item[data-danger="true"] { color: var(--xf-danger); }
.xf-menu-separator { height: 1px; margin: 6px 0; background: var(--xf-border); }
`;

/** Toast + dialog styles, shared by the surfaces that can raise them. */
export const FEEDBACK_CSS = `
.xf-toast-stack {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 2;
  pointer-events: none;
}
.xf-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 220px;
  max-width: 420px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--xf-accent);
  color: #fff;
  font-size: 14px;
  box-shadow: var(--xf-shadow);
}
.xf-toast[data-tone="danger"] { background: var(--xf-danger); }
.xf-toast-action {
  flex: 0 0 auto;
  font-weight: 700;
  color: #fff;
  text-decoration: underline;
}

.xf-dialog-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .4);
  z-index: 3;
}
.xf-dialog {
  width: min(90vw, 340px);
  padding: 24px;
  border-radius: 16px;
  background: var(--xf-bg-elevated);
  box-shadow: var(--xf-shadow);
}
.xf-dialog h2 { margin: 0 0 8px; font-size: 20px; font-weight: 800; }
.xf-dialog p { margin: 0 0 20px; font-size: 15px; color: var(--xf-text-muted); white-space: pre-line; }
.xf-dialog-actions { display: flex; flex-direction: column; gap: 10px; }
.xf-button {
  width: 100%;
  padding: 10px 16px;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}
.xf-button[data-variant="danger"] { background: var(--xf-danger); color: #fff; }
.xf-button[data-variant="ghost"] { border: 1px solid var(--xf-border); color: var(--xf-text); }
`;
