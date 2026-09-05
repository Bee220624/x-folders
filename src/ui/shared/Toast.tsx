import { useEffect, useState } from 'preact/hooks';
import { toasts, type Toast } from './toastStore';

export function ToastHost(): preact.JSX.Element | null {
  const [items, setItems] = useState<readonly Toast[]>(toasts.toasts);
  useEffect(() => toasts.subscribe(setItems), []);

  if (items.length === 0) return null;
  return (
    <div class="xf-toast-stack" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} class="xf-toast" data-tone={toast.tone}>
          <span>{toast.message}</span>
          {toast.action !== undefined && (
            <button
              type="button"
              class="xf-toast-action"
              onClick={() => {
                toast.action?.run();
                toasts.dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
