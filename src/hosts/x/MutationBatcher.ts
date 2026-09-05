import type { CleanupRegistry } from '@/utils/cleanup';

export interface BatcherOptions {
  /** Coalesced flush target. Defaults to the next animation frame. */
  onFlush: (records: MutationRecord[]) => void;
  registry: CleanupRegistry;
}

/**
 * Queues MutationRecords and flushes them once per frame.
 *
 * The observer callback itself does almost nothing: X's timeline can emit
 * hundreds of records in a single burst, and doing per-record DOM work inside
 * the callback is what makes scrolling stutter. Records are pushed onto an array
 * and drained on the next frame, deduplicated by the consumer.
 */
export class MutationBatcher {
  #queue: MutationRecord[] = [];
  #frame: number | null = null;
  #observer: MutationObserver | null = null;
  readonly #onFlush: (records: MutationRecord[]) => void;
  readonly #registry: CleanupRegistry;

  constructor(options: BatcherOptions) {
    this.#onFlush = options.onFlush;
    this.#registry = options.registry;
  }

  observe(target: Node, init: MutationObserverInit): void {
    this.disconnect();
    const observer = new MutationObserver((records) => {
      this.#queue.push(...records);
      this.#schedule();
    });
    observer.observe(target, init);
    this.#observer = observer;
    this.#registry.addObserver(observer);
  }

  #schedule(): void {
    if (this.#frame !== null) return;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback): number =>
            setTimeout(() => callback(Date.now()), 16) as unknown as number;
    this.#frame = raf(() => {
      this.#frame = null;
      this.flush();
    });
  }

  /** Drains immediately. Exposed so tests need no frame scheduling. */
  flush(): void {
    if (this.#queue.length === 0) return;
    const records = this.#queue;
    this.#queue = [];
    // takeRecords() drains anything the observer buffered since the last
    // callback, so a flush never leaves a partially observed batch behind.
    if (this.#observer !== null) records.push(...this.#observer.takeRecords());
    this.#onFlush(records);
  }

  disconnect(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    if (this.#frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#frame);
      else clearTimeout(this.#frame);
      this.#frame = null;
    }
    this.#queue = [];
  }
}
