import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/ui/shared/ConfirmDialog';

/**
 * Wait for Preact's effect flush.
 *
 * Deliberately NOT `options.requestAnimationFrame = cb => cb()`: that hoists the
 * effect flush into the commit, ahead of ref assignment, so `confirmRef.current`
 * is still null and the focus assertions would test the shim rather than the
 * component.
 */
const settle = async (): Promise<void> => {
  // Preact schedules the flush on requestAnimationFrame, which jsdom drives on a
  // real ~16ms frame clock, so a microtask or a 0ms timer is not enough.
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

let container: HTMLElement | null = null;

async function mount(onCancel: () => void): Promise<HTMLElement> {
  container ??= document.body.appendChild(document.createElement('div'));
  render(
    <ConfirmDialog
      title="删除「学习」？"
      body="这将删除该文件夹及其中的 3 条收藏记录。"
      confirmLabel="删除"
      cancelLabel="取消"
      danger
      onConfirm={() => {}}
      onCancel={onCancel}
    />,
    container,
  );
  await settle();
  return container;
}

function buttons(): HTMLElement[] {
  return Array.from(
    (container ?? document.body).querySelectorAll<HTMLElement>('.xf-dialog-actions button'),
  );
}

describe('ConfirmDialog', () => {
  afterEach(() => {
    if (container !== null) render(null, container);
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it('focuses the confirm button on mount', async () => {
    await mount(() => {});
    const [confirm, cancel] = buttons();
    expect(confirm?.textContent).toBe('删除');
    expect(cancel?.textContent).toBe('取消');
    expect(document.activeElement).toBe(confirm);
  });

  it('does not steal focus back when a re-render arrives', async () => {
    await mount(() => {});
    const [, cancel] = buttons();
    expect(cancel).toBeDefined();
    if (cancel === undefined) return;

    // The user deliberately moves to the non-destructive option.
    cancel.focus();
    expect(document.activeElement).toBe(cancel);

    // A write in another tab reaches this tab through the change channel and
    // the sidebar re-renders. Focusing on every render would drag the user onto
    // the destructive button, where the next Enter deletes their folder.
    for (let i = 0; i < 3; i += 1) await mount(() => {});

    expect(document.activeElement).toBe(buttons()[1]);
  });

  it('cancels on Escape and keeps working across re-renders', async () => {
    const first = vi.fn();
    await mount(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(first).toHaveBeenCalledOnce();

    // A later render must rebind to the NEW callback, not keep the stale one.
    const second = vi.fn();
    await mount(second);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(second).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
  });

  it('cancels on a backdrop click but not on a click inside the dialog', async () => {
    const onCancel = vi.fn();
    await mount(onCancel);
    const dialog = (container ?? document.body).querySelector<HTMLElement>('.xf-dialog');
    dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCancel).not.toHaveBeenCalled();

    const backdrop = (container ?? document.body).querySelector<HTMLElement>('.xf-dialog-backdrop');
    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
