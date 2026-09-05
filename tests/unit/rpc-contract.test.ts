import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRetryable, rpc } from '@/messaging/RpcClient';
import { registerRpcServer } from '@/background/rpc/RpcServer';
import { RPC_METHODS, type RpcMethod } from '@/messaging/protocol';

/**
 * Installs a fake service worker that records every method it receives and can
 * drop the response for the first N calls, which is exactly what a worker torn
 * down after committing its transaction looks like from the content script.
 */
function installWorker(options: { dropFirst: number }): { calls: RpcMethod[] } {
  const calls: RpcMethod[] = [];
  let dropped = 0;
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
    message: unknown,
    callback: (response: unknown) => void,
  ) => {
    const request = message as { method: RpcMethod };
    calls.push(request.method);
    if (dropped < options.dropFirst) {
      dropped += 1;
      // The write lands; only the reply is lost.
      queueMicrotask(() => {
        (chrome.runtime as { lastError?: { message: string } }).lastError = {
          message: 'The message port closed before a response was received.',
        };
        callback(undefined);
        delete (chrome.runtime as { lastError?: { message: string } }).lastError;
      });
      return undefined;
    }
    queueMicrotask(() => callback({ ok: true, data: null }));
    return undefined;
  }) as typeof chrome.runtime.sendMessage);
  return { calls };
}

describe('RPC retry contract', () => {
  afterEach(() => vi.restoreAllMocks());

  it('classifies every method, and only genuinely idempotent ones are retryable', () => {
    // A new method must be classified deliberately, not inherit a default.
    for (const method of RPC_METHODS) expect(typeof isRetryable(method)).toBe('boolean');

    // Position swaps, creates and deletes must never be re-sent: the response
    // is what was lost, not the write.
    expect(isRetryable('folders.moveUp')).toBe(false);
    expect(isRetryable('folders.moveDown')).toBe(false);
    expect(isRetryable('folders.create')).toBe(false);
    expect(isRetryable('folders.delete')).toBe(false);
    expect(isRetryable('memberships.removeTweet')).toBe(false);

    expect(isRetryable('folders.list')).toBe(true);
    expect(isRetryable('memberships.saveTweet')).toBe(true);
    expect(isRetryable('folders.rename')).toBe(true);
    expect(isRetryable('folders.setCollapsed')).toBe(true);
  });

  it('does not re-send a move when the response is lost', async () => {
    const worker = installWorker({ dropFirst: 1 });
    const result = await rpc('folders.moveUp', { folderId: 'f1' });

    // One user click must reach the database at most once, or "move up" moves
    // the folder two positions.
    expect(worker.calls).toEqual(['folders.moveUp']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RPC_UNAVAILABLE');
  });

  it('does not re-send a create when the response is lost', async () => {
    const worker = installWorker({ dropFirst: 1 });
    await rpc('folders.create', { name: 'AI', parentId: null });
    // A retry would hit assertNameAvailable and tell the user their successful
    // create failed as a duplicate.
    expect(worker.calls).toEqual(['folders.create']);
  });

  it('still retries an idempotent write exactly once', async () => {
    const worker = installWorker({ dropFirst: 1 });
    const result = await rpc('folders.list', undefined);
    expect(worker.calls).toEqual(['folders.list', 'folders.list']);
    expect(result.ok).toBe(true);
  });

  it('gives up after a single retry rather than looping', async () => {
    const worker = installWorker({ dropFirst: 99 });
    const result = await rpc('folders.list', undefined);
    expect(worker.calls).toHaveLength(2);
    expect(result.ok).toBe(false);
  });
});

describe('RpcServer response channel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers its listener synchronously at module scope', () => {
    const addListener = vi.spyOn(chrome.runtime.onMessage, 'addListener');
    registerRpcServer({} as never);
    expect(addListener).toHaveBeenCalledOnce();
  });

  it('returns true synchronously so the async reply channel stays open', () => {
    let listener: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean) | null = null;
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(((fn: never) => {
      listener = fn;
    }) as never);

    registerRpcServer({
      'health.ping': async () => ({ ok: true, version: '0.1.0' }),
    } as never);
    expect(listener).not.toBeNull();

    const returned = listener!(
      { kind: 'xf:rpc', method: 'health.ping', payload: undefined },
      {},
      () => {},
    );
    // Chrome closes the channel unless the listener returns literal true; an
    // async listener returns a Promise and every reply is dropped.
    expect(returned).toBe(true);
  });

  it('survives a sendResponse that throws because the channel closed', async () => {
    let listener: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean) | null = null;
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(((fn: never) => {
      listener = fn;
    }) as never);
    registerRpcServer({
      'health.ping': async () => ({ ok: true, version: '0.1.0' }),
    } as never);

    let sends = 0;
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onRejection);

    listener!({ kind: 'xf:rpc', method: 'health.ping', payload: undefined }, {}, () => {
      sends += 1;
      throw new Error('Attempting to use a disconnected port object');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    window.removeEventListener('unhandledrejection', onRejection);

    // Exactly one attempt, and the throw must not become a second send or an
    // unhandled rejection inside the worker.
    expect(sends).toBe(1);
    expect(rejections).toEqual([]);
  });

  it('ignores messages that are not ours', () => {
    let listener: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean) | null = null;
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(((fn: never) => {
      listener = fn;
    }) as never);
    registerRpcServer({} as never);
    expect(listener!({ kind: 'someone-elses-message' }, {}, () => {})).toBe(false);
  });
});
