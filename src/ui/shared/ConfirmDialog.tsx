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

  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [props]);

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
