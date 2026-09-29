const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const LINK_TEXT_MAX = 30;

/** "9月28日", or "2025年9月28日" outside the current year — local time, as X shows it. */
export function formatDay(at: number, now: number): string {
  const date = new Date(at);
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${date.getFullYear()}年${day}`;
}

/** X's own style: "20秒", "5分钟", "3小时" within a day, then the date. */
export function formatPostedAt(postedAt: number, now: number): string {
  const elapsed = now - postedAt;
  if (elapsed >= 0 && elapsed < MINUTE_MS) return `${Math.max(1, Math.floor(elapsed / SECOND_MS))}秒`;
  if (elapsed >= 0 && elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}分钟`;
  if (elapsed >= 0 && elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}小时`;
  return formatDay(postedAt, now);
}

/** Link text as X shows it: no scheme, no "www.", at most 30 characters. */
export function displayLinkText(text: string): string {
  const bare = text.replace(/^https?:\/\/(?:www\.)?/, '').replace(/…$/, '');
  return bare.length > LINK_TEXT_MAX ? `${bare.slice(0, LINK_TEXT_MAX)}…` : bare;
}
