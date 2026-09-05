/**
 * One registry per long-lived subsystem. Everything that must be undone on
 * content-script invalidation registers here; `dispose()` is idempotent and
 * never throws, so a single bad teardown cannot strand the rest.
 */
export type Disposer = () => void;

export class CleanupRegistry {
  #disposers: Disposer[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Number of registered disposers.
   *
   * Exposed because "the registry grows one dead closure per mutation batch /
   * per navigation / per visibility cycle" is a real and previously-shipped
   * failure mode that is otherwise invisible: everything still works, the tab
   * just leaks for hours. Regression tests assert on this.
   */
  get size(): number {
    return this.#disposers.length;
  }

  /**
   * Registers a disposer and returns a handle that RUNS it early and removes it
   * from the registry. Calling the handle twice is a no-op, and a later
   * `dispose()` will not run it again.
   *
   * The handle deliberately disposes rather than merely unregistering: a handle
   * that silently detached the cleanup without performing it would leave live
   * listeners behind at exactly the call sites that look most careful.
   */
  add(disposer: Disposer): Disposer {
    if (this.#disposed) {
      disposer();
      return () => {};
    }
    this.#disposers.push(disposer);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const index = this.#disposers.indexOf(disposer);
      if (index >= 0) this.#disposers.splice(index, 1);
      disposer();
    };
  }

  addObserver(observer: { disconnect(): void }): Disposer {
    return this.add(() => observer.disconnect());
  }

  addInterval(handle: ReturnType<typeof setInterval>): Disposer {
    return this.add(() => clearInterval(handle));
  }

  addTimeout(handle: ReturnType<typeof setTimeout>): Disposer {
    return this.add(() => clearTimeout(handle));
  }

  addEventListener<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): Disposer;
  addEventListener<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): Disposer;
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): Disposer {
    target.addEventListener(type, listener, options);
    return this.add(() => target.removeEventListener(type, listener, options));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    // Reverse order: later registrations usually depend on earlier ones.
    for (const disposer of this.#disposers.slice().reverse()) {
      try {
        disposer();
      } catch {
        // A failed disposer must not strand the others.
      }
    }
    this.#disposers = [];
  }
}
