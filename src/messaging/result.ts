import type { ErrorCode, SerializedError } from '@/core/errors/DomainError';

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedError };

export function ok<T>(data: T): RpcResult<T> {
  return { ok: true, data };
}

export function fail<T>(code: ErrorCode, message: string): RpcResult<T> {
  return { ok: false, error: { code, message } };
}
