/**
 * Serialises an async routine so overlapping calls collapse into one run plus,
 * at most, one queued re-run.
 *
 * Used for the reinitialize path: a route change, a root mutation and a health
 * tick can all ask for the same repair within a frame, and running three
 * concurrent re-mounts is how duplicate hosts appear in the first place.
 */
export function singleFlight(run: () => Promise<void> | void): () => Promise<void> {
  let active: Promise<void> | null = null;
  let queued = false;

  const start = async (): Promise<void> => {
    // try/finally, not a trailing assignment: a throw would otherwise leave
    // `active` holding a rejected promise forever, and every later call would
    // return that same rejection without ever invoking run() again.
    try {
      do {
        queued = false;
        await run();
      } while (queued);
    } finally {
      active = null;
    }
  };

  return async (): Promise<void> => {
    if (active !== null) {
      queued = true;
      return active;
    }
    active = start();
    return active;
  };
}
