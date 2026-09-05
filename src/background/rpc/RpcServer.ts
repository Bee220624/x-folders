import { createLogger } from '@/utils/logger';
import { toSerializedError } from '@/core/errors/DomainError';
import { isRpcRequest, type RpcMethod, type RpcRequest } from '@/messaging/protocol';
import { validatePayload } from '@/messaging/validate';
import { ok, type RpcResult } from '@/messaging/result';

const log = createLogger('rpc-server');

export type RpcHandler = (payload: unknown) => Promise<unknown>;
export type RpcHandlers = Record<RpcMethod, RpcHandler>;

/**
 * Registers the message listener. This MUST be called synchronously at module
 * top level: a listener attached inside an `await` is not present when the
 * worker is woken by a message, and the message is lost.
 *
 * The listener itself is deliberately NOT `async`. `chrome.runtime.onMessage`
 * closes the response channel unless the listener synchronously returns literal
 * `true`; an async listener returns a Promise, so every reply would be dropped
 * and every caller would see `undefined`.
 */
export function registerRpcServer(handlers: RpcHandlers): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: RpcResult<unknown>) => void): boolean => {
      if (!isRpcRequest(message)) return false;
      // Chrome throws from sendResponse once the channel is gone (the sender
      // navigated, or its content-script context was invalidated mid-handler).
      // Without this guard that throw lands in the .catch below, which sends
      // again on the same dead channel and leaves an unhandled rejection in the
      // worker.
      const reply = (result: RpcResult<unknown>): void => {
        try {
          sendResponse(result);
        } catch (error) {
          log.debug('response channel closed', error);
        }
      };
      void dispatch(handlers, message)
        .then(reply)
        .catch((error: unknown) => {
          // dispatch() already converts errors; this is the last-resort net so a
          // caller never hangs until its own timeout fires.
          log.error('dispatch escaped', error);
          reply({ ok: false, error: toSerializedError(error) });
        });
      return true;
    },
  );
}

async function dispatch(handlers: RpcHandlers, request: RpcRequest): Promise<RpcResult<unknown>> {
  const started = Date.now();
  try {
    const payload = validatePayload(request.method, request.payload);
    const handler = handlers[request.method];
    const data = await handler(payload);
    log.debug(request.method, `${Date.now() - started}ms`);
    return ok(data);
  } catch (error) {
    const serialized = toSerializedError(error);
    log.warn(request.method, 'failed', serialized.code, error);
    return { ok: false, error: serialized };
  }
}
