import { useEffect, useRef, useState } from 'preact/hooks';

export interface InlineNameEditorProps {
  initialValue: string;
  placeholder: string;
  /** Resolves to an error message, or null on success. */
  onCommit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}

/**
 * The single inline text field used for both "new folder" and "rename".
 *
 * Enter commits, Escape cancels, blur commits a non-empty value and cancels an
 * empty one. On a rejected name (duplicate, too long) the field keeps the user's
 * text and shows the reason rather than throwing the input away.
 */
export function InlineNameEditor(props: InlineNameEditorProps): preact.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, []);

  const commit = async (): Promise<void> => {
    if (busy.current || cancelled.current) return;
    const value = inputRef.current?.value ?? '';
    if (value.trim().length === 0) {
      props.onCancel();
      return;
    }
    busy.current = true;
    const message = await props.onCommit(value);
    busy.current = false;
    // A late rejection must not resurrect an editor the user already dismissed.
    if (cancelled.current) return;
    setError(message);
    if (message === null) return;
    inputRef.current?.focus();
  };

  return (
    <div>
      <input
        ref={inputRef}
        class="xf-input"
        type="text"
        maxLength={64}
        placeholder={props.placeholder}
        value={props.initialValue}
        aria-label={props.placeholder}
        aria-invalid={error !== null}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            props.onCancel();
          }
        }}
        onBlur={() => void commit()}
      />
      {error !== null && <div class="xf-error">{error}</div>}
    </div>
  );
}
