import { describe, expect, it } from 'vitest';
import { readSegments } from '@/hosts/x/extractText';
import { X_SELECTORS } from '@/hosts/x/selectors';
import { mountPost, postHtml } from '../helpers/postDom';

function segmentsOf(textHtml: string): ReturnType<typeof readSegments> {
  const root = mountPost(postHtml({ textHtml }));
  const text = root.querySelector(X_SELECTORS.tweetText);
  if (text === null) throw new Error('no tweetText');
  return readSegments(text);
}

describe('readSegments', () => {
  it('splits text, mentions, links, hashtags, emoji and newlines', () => {
    expect(
      segmentsOf(
        '<span>Hi </span><div><span><a href="/bob" role="link">@bob</a></span></div><span> see </span>' +
          '<a href="https://t.co/abc" target="_blank" role="link"><span aria-hidden="true">https://</span>' +
          'example.com/post<span aria-hidden="true">…</span></a>' +
          '<span> </span><span><a href="/hashtag/AI?src=hashtag_click" role="link">#AI</a></span>' +
          '<img alt="🎉" src="https://abs-0.twimg.com/emoji/v2/svg/1f389.svg"><br><span>line two</span>',
      ),
    ).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', text: '@bob', username: 'bob' },
      { kind: 'text', text: ' see ' },
      { kind: 'link', text: 'https://example.com/post…', url: 'https://t.co/abc' },
      { kind: 'text', text: ' ' },
      { kind: 'hashtag', text: '#AI', tag: 'AI' },
      { kind: 'emoji', text: '🎉' },
      { kind: 'text', text: '\nline two' },
    ]);
  });

  it('trims the outer whitespace and keeps the inner newlines', () => {
    expect(segmentsOf('<span>  a</span><br><br><span>b  </span>')).toEqual([{ kind: 'text', text: 'a\n\nb' }]);
  });

  it('treats a cashtag search as a plain link', () => {
    expect(segmentsOf('<a href="/search?q=%24TSLA&amp;src=cashtag_click" role="link">$TSLA</a>')).toEqual([
      { kind: 'link', text: '$TSLA', url: 'https://x.com/search?q=%24TSLA&src=cashtag_click' },
    ]);
  });

  it('does not call a profile link a mention unless its text starts with "@"', () => {
    expect(segmentsOf('<a href="/bob" role="link">Bob</a>')).toEqual([
      { kind: 'link', text: 'Bob', url: 'https://x.com/bob' },
    ]);
  });

  it('decodes a non-ASCII hashtag', () => {
    expect(
      segmentsOf('<a href="/hashtag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD?src=hashtag_click">#人工智能</a>'),
    ).toEqual([{ kind: 'hashtag', text: '#人工智能', tag: '人工智能' }]);
  });
});
