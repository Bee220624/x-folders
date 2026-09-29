import { describe, expect, it } from 'vitest';
import { readAuthor } from '@/hosts/x/extractAuthor';
import { pictureIn, readTime } from '@/hosts/x/extractPicture';
import { X_SELECTORS } from '@/hosts/x/selectors';
import { mountPost, postHtml, quoteHtml } from '../helpers/postDom';

const AVATAR = 'https://pbs.twimg.com/profile_images/1/alice_normal.jpg';

describe('readAuthor', () => {
  it('reads the display name, handle, check mark and avatar', () => {
    const root = mountPost(postHtml({ name: 'Alice A.', verified: true }));
    expect(readAuthor(root, [])).toEqual({
      hasHeader: true,
      authorName: 'Alice A.',
      handle: 'alice',
      verified: true,
      avatarUrl: AVATAR,
    });
  });

  it('reports no check mark when there is none', () => {
    expect(readAuthor(mountPost(postHtml()), []).verified).toBe(false);
  });

  it('reads an avatar painted only as a background', () => {
    expect(readAuthor(mountPost(postHtml({ avatarAs: 'background' })), []).avatarUrl).toBe(AVATAR);
  });

  it('leaves the avatar empty until it has loaded, and never takes a placeholder', () => {
    expect(readAuthor(mountPost(postHtml({ avatar: null })), []).avatarUrl).toBeNull();
    const placeholder = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    expect(readAuthor(mountPost(postHtml({ avatar: placeholder })), []).avatarUrl).toBeNull();
  });

  it('keeps the outer author and the quoted author apart', () => {
    const root = mountPost(postHtml({ quoteHtml: quoteHtml({ user: 'bob', name: 'Bob', verified: true }) }));
    const quote = root.querySelector(X_SELECTORS.quoteContainer);
    expect(quote).not.toBeNull();
    if (quote === null) return;
    expect(readAuthor(root, [quote])).toMatchObject({ authorName: 'Alice', handle: 'alice', verified: false });
    expect(readAuthor(quote, [])).toEqual({
      hasHeader: true,
      authorName: 'Bob',
      handle: 'bob',
      verified: true,
      avatarUrl: 'https://pbs.twimg.com/profile_images/2/bob_normal.jpg',
    });
  });

  it('knows when X has not rendered the header yet', () => {
    const root = mountPost('<article data-testid="tweet"><div data-testid="tweetText"><span>x</span></div></article>');
    expect(readAuthor(root, [])).toEqual({
      hasHeader: false,
      authorName: null,
      handle: null,
      verified: false,
      avatarUrl: null,
    });
  });
});

describe('readTime and pictureIn', () => {
  it('parses a datetime and rejects anything else', () => {
    const root = mountPost(postHtml({ datetime: '2026-09-28T10:00:00.000Z' }));
    const time = root.querySelector(X_SELECTORS.time);
    expect(readTime(time)).toBe(Date.UTC(2026, 8, 28, 10));
    time?.setAttribute('datetime', 'soon');
    expect(readTime(time)).toBeNull();
    expect(readTime(null)).toBeNull();
  });

  it('finds nothing in a missing scope', () => {
    expect(pictureIn(null)).toBeNull();
  });
});
