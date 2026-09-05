import { FOLDER_NAME_MAX, FOLDER_NAME_MIN } from '@/core/constants';
import { DomainError } from '@/core/errors/DomainError';

/**
 * C0/C1 controls plus the Unicode line/paragraph separators. Built through
 * `RegExp` so the source file stays free of literal control characters.
 */
// Matching control characters is the entire point here: they must never reach a
// stored folder name.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]');

/** Leading/trailing whitespace including NBSP and BOM. */
const OUTER_WHITESPACE = new RegExp('^[\\s\\uFEFF\\u00A0]+|[\\s\\uFEFF\\u00A0]+$', 'g');

/**
 * Trims, NFC-normalises and validates a folder name. Throws
 * `INVALID_FOLDER_NAME` rather than returning null so callers cannot ignore it.
 */
export function normalizeFolderName(raw: string): string {
  const name = raw.normalize('NFC').trim();
  if (name.length < FOLDER_NAME_MIN || name.length > FOLDER_NAME_MAX) {
    throw new DomainError('INVALID_FOLDER_NAME', '文件夹名称长度不合法。', {
      length: name.length,
    });
  }
  if (CONTROL_CHARS.test(name)) {
    throw new DomainError('INVALID_FOLDER_NAME', '文件夹名称包含控制字符。');
  }
  return name;
}

/**
 * Comparison key for sibling uniqueness: NFC + lower-cased. Close enough to full
 * case folding for folder names, and matches what users read as "the same name".
 */
export function folderNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/** Strips outer whitespace but keeps interior newlines, then caps the length. */
export function trimTweetText(text: string, max: number): string {
  const trimmed = text.replace(OUTER_WHITESPACE, '');
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
