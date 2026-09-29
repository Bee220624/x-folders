import { XFoldersDatabase } from '@/background/db/XFoldersDatabase';
import type { TweetRecord } from '@/core/domain/tweet';

let counter = 0;

/** A fresh, isolated database per test so ordering never leaks between cases. */
export async function freshDatabase(): Promise<XFoldersDatabase> {
  counter += 1;
  const name = `x-folders-test-${counter}-${Math.random().toString(36).slice(2)}`;
  const db = new XFoldersDatabase(name);
  await db.open();
  return db;
}

interface TweetOverrides {
  username?: string;
  authorName?: string | null;
  text?: string;
  capturedAt?: number;
}

export function tweetFixture(id: string, overrides: TweetOverrides = {}): TweetRecord {
  const username = overrides.username ?? 'alice';
  const text = overrides.text ?? 'hello';
  return {
    tweetId: id,
    canonicalUrl: `https://x.com/${username}/status/${id}`,
    username,
    authorName: overrides.authorName === undefined ? 'Alice' : overrides.authorName,
    avatarUrl: null,
    verified: false,
    postedAt: null,
    text,
    segments: text.length > 0 ? [{ kind: 'text', text }] : [],
    media: [],
    quote: null,
    card: null,
    truncated: false,
    capturedAt: overrides.capturedAt ?? 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}
