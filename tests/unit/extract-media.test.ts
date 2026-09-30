import { describe, expect, it } from 'vitest';
import { readCard, readMedia } from '@/hosts/x/extractMedia';
import { X_SELECTORS } from '@/hosts/x/selectors';
import { cardHtml, mountPost, postHtml, quoteHtml } from '../helpers/postDom';

const photo = (id: string): string => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;

function quotesOf(root: Element): Element[] {
  return Array.from(root.querySelectorAll(X_SELECTORS.quoteContainer));
}

describe('readMedia', () => {
  it('reads photos in page order, at most four', () => {
    const root = mountPost(postHtml({ photos: ['A', 'B', 'C', 'D', 'E'].map(photo) }));
    expect(readMedia(root, [])).toEqual(
      ['A', 'B', 'C', 'D'].map((id) => ({ kind: 'photo', url: photo(id), alt: '图像' })),
    );
  });

  it('reads a video poster, and a GIF by its poster path', () => {
    const video = 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg';
    const gif = 'https://pbs.twimg.com/tweet_video_thumb/g.jpg';
    expect(readMedia(mountPost(postHtml({ video: { poster: video } })), [])).toEqual([
      { kind: 'video', url: video, alt: null },
    ]);
    expect(readMedia(mountPost(postHtml({ video: { poster: gif } })), [])).toEqual([
      { kind: 'gif', url: gif, alt: null },
    ]);
  });

  it('falls back to the picture inside the cell when the poster attribute is missing', () => {
    const video = 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg';
    const root = mountPost(postHtml({ video: { poster: video } }));
    root.querySelector(X_SELECTORS.video)?.removeAttribute('poster');
    expect(readMedia(root, [])).toEqual([{ kind: 'video', url: video, alt: null }]);
  });

  it('skips a picture that has not loaded yet', () => {
    const root = mountPost(postHtml({ photos: ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', photo('B')] }));
    expect(readMedia(root, []).map((item) => item.url)).toEqual([photo('B')]);
  });

  it('leaves the quoted post’s picture out of the outer post', () => {
    const root = mountPost(postHtml({ photos: [photo('OUT')], quoteHtml: quoteHtml({ photo: photo('IN') }) }));
    expect(readMedia(root, quotesOf(root)).map((item) => item.url)).toEqual([photo('OUT')]);
  });
});

describe('readCard', () => {
  it('reads a large card: link, title and picture — X shows it no domain', () => {
    const root = mountPost(postHtml({ cardHtml: cardHtml() }));
    expect(readCard(root, [])).toEqual({
      url: 'https://t.co/card',
      layout: 'large',
      title: 'A card title',
      domain: null,
      imageUrl: 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=small',
    });
  });

  it('knows a small card and one without a picture', () => {
    const root = mountPost(
      postHtml({ cardHtml: cardHtml({ layout: 'small', image: null, domainLine: 'news.example.org' }) }),
    );
    expect(readCard(root, [])).toMatchObject({ layout: 'small', domain: 'news.example.org', imageUrl: null });
  });

  it('keeps a title that merely ends in a dotted word', () => {
    const root = mountPost(postHtml({ cardHtml: cardHtml({ title: 'Why I still use Node.js' }) }));
    expect(readCard(root, [])?.title).toBe('Why I still use Node.js');
  });

  it('finds no card where there is none, or only inside the quote', () => {
    expect(readCard(mountPost(postHtml()), [])).toBeNull();
    const root = mountPost(
      postHtml({
        quoteHtml: quoteHtml().replace('<div data-testid="tweetText"', `${cardHtml()}<div data-testid="tweetText"`),
      }),
    );
    expect(readCard(root, quotesOf(root))).toBeNull();
  });
});
