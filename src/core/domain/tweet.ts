export type TweetId = string;

export interface TweetRecord {
  tweetId: TweetId;
  /** Always `https://x.com/{username}/status/{tweetId}`. */
  canonicalUrl: string;
  authorName: string | null;
  username: string;
  /** Plain text; may be empty for media-only posts. */
  text: string;
  capturedAt: number;
  updatedAt: number;
}
