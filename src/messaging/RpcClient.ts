import { createLogger } from '@/utils/logger';
import { fail, type RpcResult } from './result';
import type { PayloadOf, ResultOf, RpcMethod, RpcRequest } from './protocol';

const log = createLogger('rpc-client');

/**
 * The MV3 worker is terminated after ~30s idle and IndexedDB work does not reset
 * that timer, so any single call can land while the worker is being torn down.
 * Every call therefore gets a timeout and exactly one retry; the retry re-wakes
 * the worker. This is safe because every write RPC is specified as idempotent.
 */
const TIMEOUT_MS = 10_000;

function sendOnce<M extends RpcMethod>(
  method: M,
  payload: PayloadOf<M>,
): Promise<RpcResult<ResultOf<M>>> {
  const request: RpcRequest<M> = { kind: 'xf:rpc', method, payload };
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fail('RPC_TIMEOUT', '后台响应超时。'));
    }, TIMEOUT_MS);

    const finish = (result: RpcResult<ResultOf<M>>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    try {
      chrome.runtime.sendMessage(request, (response: unknown) => {
        // Reading lastError is mandatory; leaving it unread logs an
        // "Unchecked runtime.lastError" warning into the page console.
        const lastError = chrome.runtime.lastError;
        if (lastError !== undefined) {
          log.debug('sendMessage failed', method, lastError.message);
          finish(fail('RPC_UNAVAILABLE', '扩展后台不可用。'));
          return;
        }
        if (typeof response !== 'object' || response === null || !('ok' in response)) {
          finish(fail('RPC_UNAVAILABLE', '后台返回了无法识别的响应。'));
          return;
        }
        finish(response as RpcResult<ResultOf<M>>);
      });
    } catch (error) {
      // Throws synchronously once the content script context is invalidated.
      log.debug('sendMessage threw', method, error);
      finish(fail('RPC_UNAVAILABLE', '扩展上下文已失效。'));
    }
  });
}

const RETRYABLE_ERRORS = new Set(['RPC_TIMEOUT', 'RPC_UNAVAILABLE']);

/**
 * Methods that may be sent twice for one user action.
 *
 * RPC_TIMEOUT and RPC_UNAVAILABLE mean the *response* was lost, not that the
 * request never arrived — a worker torn down after committing its transaction
 * produces exactly that. So a retry can re-execute a write that already
 * succeeded, and only genuinely idempotent methods are safe here:
 *   - every read;
 *   - saveTweet, whose membership has a compound primary key and whose savedAt
 *     is never rewritten;
 *   - tweets.refresh, which only ever completes a snapshot, so applying it
 *     twice is the same as applying it once;
 *   - rename and setCollapsed, which are no-ops when the value already matches.
 *
 * Deliberately absent: create (a retry hits the duplicate-name check and tells
 * the user their successful create failed), delete and removeTweet (a retry
 * reports NOT_FOUND for something it just removed), and moveUp/moveDown, which
 * are position swaps — one click of "move up" would move the folder twice.
 */
const RETRYABLE_METHODS: ReadonlySet<RpcMethod> = new Set<RpcMethod>([
  'health.ping',
  'folders.list',
  'folders.deletePreview',
  'folders.rename',
  'folders.setCollapsed',
  'memberships.getForTweet',
  'memberships.getCountsForTweets',
  'memberships.listFolderTweets',
  'memberships.saveTweet',
  'tweets.refresh',
  'meta.getRecentFolders',
]);

export function isRetryable(method: RpcMethod): boolean {
  return RETRYABLE_METHODS.has(method);
}

export async function rpc<M extends RpcMethod>(
  method: M,
  payload: PayloadOf<M>,
): Promise<RpcResult<ResultOf<M>>> {
  const first = await sendOnce(method, payload);
  if (first.ok || !RETRYABLE_ERRORS.has(first.error.code)) return first;
  if (!RETRYABLE_METHODS.has(method)) {
    // The write may well have committed; re-sending it would apply it twice.
    // The caller refreshes from the store instead, so the UI converges on
    // whatever actually landed.
    log.debug('not retrying non-idempotent method', method, first.error.code);
    return first;
  }
  log.debug('retrying', method, first.error.code);
  return sendOnce(method, payload);
}

/** Convenience wrapper for call sites that only care about the happy path. */
export async function rpcOrNull<M extends RpcMethod>(
  method: M,
  payload: PayloadOf<M>,
): Promise<ResultOf<M> | null> {
  const result = await rpc(method, payload);
  if (result.ok) return result.data;
  log.warn(method, 'failed', result.error.code);
  return null;
}
