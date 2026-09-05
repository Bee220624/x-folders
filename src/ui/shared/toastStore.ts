export type ToastTone = 'default' | 'danger';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

type Listener = (toasts: readonly Toast[]) => void;

const DEFAULT_TTL_MS = 4000;

/**
 * A tiny singleton queue. Toasts are raised from the sidebar, the popover and
 * the folder view, so the store lives outside all three and the host renders
 * whatever is current.
 */
class ToastStore {
  #toasts: Toast[] = [];
  #nextId = 1;
  readonly #listeners = new Set<Listener>();
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();

  get toasts(): readonly Toast[] {
    return this.#toasts;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#toasts);
    return () => this.#listeners.delete(listener);
  }

  show(message: string, options: { tone?: ToastTone; action?: ToastAction; ttl?: number } = {}): number {
    const id = this.#nextId++;
    const toast: Toast = { id, message, tone: options.tone ?? 'default' };
    if (options.action !== undefined) toast.action = options.action;
    this.#toasts = [...this.#toasts, toast];
    this.#emit();

    const timer = setTimeout(() => this.dismiss(id), options.ttl ?? DEFAULT_TTL_MS);
    this.#timers.set(id, timer);
    return id;
  }

  dismiss(id: number): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
    const next = this.#toasts.filter((toast) => toast.id !== id);
    if (next.length === this.#toasts.length) return;
    this.#toasts = next;
    this.#emit();
  }

  /** Cancels every pending timer; called from the cleanup registry. */
  reset(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#toasts = [];
    this.#listeners.clear();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#toasts);
  }
}

export const toasts = new ToastStore();
