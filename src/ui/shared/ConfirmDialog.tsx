import { useEffect, useRef } from 'preact/hooks';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): preact.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus ONCE, on mount. Keying this on `props` would re-run on every render —
  // and this component re-renders whenever a background store refresh arrives
  // from another tab. A user who deliberately moved to 取消 would have focus
  // yanked back onto the destructive button under them.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [props.onCancel]);

  return (
    <div
      class="xf-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onCancel();
      }}
    >
      <div class="xf-dialog" role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        <p>{props.body}</p>
        <div class="xf-dialog-actions">
          <button
            ref={confirmRef}
            type="button"
            class="xf-button"
            data-variant={props.danger === true ? 'danger' : 'primary'}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
          <button type="button" class="xf-button" data-variant="ghost" onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
