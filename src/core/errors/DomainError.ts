/**
 * Stable, serialisable error codes. Everything crossing the RPC boundary is
 * reduced to one of these: `Error` objects do not survive the extension message
 * channel intact, and stacks must never reach the UI.
 */
export const ERROR_CODES = [
  'FOLDER_NOT_FOUND',
  'DUPLICATE_FOLDER_NAME',
  'INVALID_FOLDER_NAME',
  'MAX_DEPTH',
  'INVALID_TWEET_URL',
  'INVALID_TWEET_ID',
  'MEMBERSHIP_NOT_FOUND',
  'DATABASE_ERROR',
  'UNSUPPORTED_X_LAYOUT',
  'INVALID_REQUEST',
  'RPC_TIMEOUT',
  'RPC_UNAVAILABLE',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  /** Extra context for the debug log only — never rendered to the user. */
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail;
  }

  serialize(): SerializedError {
    return { code: this.code, message: this.message };
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Narrows an unknown thrown value. Anything that is not a `DomainError` becomes
 * a generic `DATABASE_ERROR`, so internal details never leave the worker.
 */
export function toSerializedError(error: unknown): SerializedError {
  if (error instanceof DomainError) return error.serialize();
  return { code: 'DATABASE_ERROR', message: '操作失败，请重试。' };
}

/** User-facing copy per code. The UI renders these, never raw messages. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  FOLDER_NOT_FOUND: '文件夹不存在或已被删除。',
  DUPLICATE_FOLDER_NAME: '同一层级下已有同名文件夹。',
  INVALID_FOLDER_NAME: '文件夹名称需为 1–64 个字符，且不能只包含空白。',
  MAX_DEPTH: '最多只支持一层子文件夹。',
  INVALID_TWEET_URL: '无法识别这条帖子的链接。',
  INVALID_TWEET_ID: '无法识别这条帖子的 ID。',
  MEMBERSHIP_NOT_FOUND: '这条帖子不在该文件夹中。',
  DATABASE_ERROR: '本地数据库操作失败，请重试。',
  UNSUPPORTED_X_LAYOUT: '当前页面布局无法识别，插件已暂停注入。',
  INVALID_REQUEST: '请求格式不正确。',
  RPC_TIMEOUT: '后台响应超时，请重试。',
  RPC_UNAVAILABLE: '扩展后台不可用，请刷新页面。',
  UNKNOWN: '发生未知错误。',
};

export function messageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}
