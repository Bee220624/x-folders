import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { TweetRecord } from '@/core/domain/tweet';
import { displayLinkText, formatDay, formatPostedAt } from '@/ui/tweet-card/format';
import { TweetCard, type OpenOptions } from '@/ui/tweet-card/TweetCard';
import { tweetFixture } from '../helpers/db';

const NOW = new Date(2026, 8, 29, 12, 0).getTime();
const photo = (id: string): string => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const RICH: TweetRecord = {
  ...tweetFixture('1'),
  authorName: 'Alice',
  verified: true,
  avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
  postedAt: new Date(2026, 8, 29, 9, 0).getTime(),
  text: 'Hi @bob https://example.com/a/very/long/path/indeed… #AI',
  segments: [
    { kind: 'text', text: 'Hi ' },
    { kind: 'mention', text: '@bob', username: 'bob' },
    { kind: 'text', text: ' ' },
    { kind: 'link', text: 'https://example.com/a/very/long/path/indeed…', url: 'https://t.co/abc' },
    { kind: 'text', text: ' ' },
    { kind: 'hashtag', text: '#AI', tag: 'AI' },
  ],
  media: [
    { kind: 'photo', url: photo('A'), alt: '图像' },
    { kind: 'video', url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg', alt: null },
  ],
};

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // A target=_blank link would try to navigate jsdom. Only those are stopped
  // here, so what the card itself prevents stays observable.
  container.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('a[target="_blank"]') !== null) {
        event.preventDefault();
      }
    },
    true,
  );
});

afterEach(() => {
  render(null, container);
  container.remove();
});

function draw(tweet: TweetRecord): Mock<(url: string, options: OpenOptions) => void> {
  const onOpen = vi.fn<(url: string, options: OpenOptions) => void>();
  render(<TweetCard tweet={tweet} now={NOW} onOpen={onOpen} />, container);
  return onOpen;
}

describe('TweetCard', () => {
  it('shows the author line like X: name, check mark, handle and time', () => {
    draw(RICH);
    expect(container.querySelector('.xf-tc-name')?.textContent).toBe('Alice');
    expect(container.querySelector('.xf-tc-verified')).not.toBeNull();
    expect(container.querySelector('.xf-tc-time')?.textContent).toBe('3小时');
    expect(container.querySelector<HTMLImageElement>('img.xf-tc-avatar')?.src).toBe(
      'https://pbs.twimg.com/profile_images/1/a_bigger.jpg',
    );
  });

  it('turns mentions, links and hashtags into links that open in a new tab', () => {
    draw(RICH);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('.xf-tc-text a'));
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.target])).toEqual([
      ['@bob', 'https://x.com/bob', '_blank'],
      ['example.com/a/very/long/path/i…', 'https://t.co/abc', '_blank'],
      ['#AI', 'https://x.com/hashtag/AI', '_blank'],
    ]);
  });

  it('lays out the pictures and marks the video poster', () => {
    draw(RICH);
    expect(container.querySelector('.xf-tc-media')?.getAttribute('data-count')).toBe('2');
    expect(Array.from(container.querySelectorAll<HTMLImageElement>('.xf-tc-media img')).map((img) => img.src)).toEqual([
      photo('A'),
      'https://pbs.twimg.com/amplify_video_thumb/1/img/v.jpg',
    ]);
    expect(container.querySelectorAll('.xf-tc-play')).toHaveLength(1);
  });

  it('never renders a picture from outside pbs.twimg.com, and greys out one that fails', async () => {
    draw({ ...RICH, media: [{ kind: 'photo', url: 'https://evil.example/x.jpg', alt: null }] });
    expect(container.querySelector('.xf-tc-media img')).toBeNull();
    expect(container.querySelector('.xf-tc-media .xf-tc-img-missing')).not.toBeNull();

    draw(RICH);
    container.querySelector('.xf-tc-media img')?.dispatchEvent(new Event('error'));
    await flush();
    expect(container.querySelectorAll('.xf-tc-media .xf-tc-img-missing')).toHaveLength(1);
  });

  it('opens the post on a click anywhere but its controls, in a new tab with ⌘/Ctrl', () => {
    const onOpen = draw(RICH);
    container.querySelector<HTMLElement>('.xf-tc-name')?.click();
    expect(onOpen).toHaveBeenLastCalledWith('https://x.com/alice/status/1', { newTab: false });
    container
      .querySelector('.xf-tc-name')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(onOpen).toHaveBeenLastCalledWith('https://x.com/alice/status/1', { newTab: true });

    onOpen.mockClear();
    container.querySelector<HTMLAnchorElement>('.xf-tc-text a')?.click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the post from its time link instead of letting the link navigate', () => {
    const onOpen = draw(RICH);
    const time = container.querySelector<HTMLAnchorElement>('.xf-tc-time');
    expect(time?.getAttribute('href')).toBe('https://x.com/alice/status/1');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    time?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers "显示更多" on a truncated post', () => {
    draw({ ...RICH, truncated: true });
    expect(container.querySelector('.xf-tc-more')?.textContent).toBe('显示更多');
  });

  it('shows the quote, and the link card when there are no pictures', () => {
    draw({
      ...RICH,
      media: [],
      quote: {
        authorName: 'Q',
        username: 'q',
        verified: false,
        avatarUrl: null,
        postedAt: null,
        text: 'quoted words',
        media: null,
        url: null,
      },
      card: { url: 'https://t.co/card', layout: 'large', title: 'A title', domain: 'example.com', imageUrl: null },
    });
    expect(container.querySelector('.xf-tc-quote-text')?.textContent).toBe('quoted words');
    expect(container.querySelector('.xf-tc-quote .xf-tc-avatar-empty')?.textContent).toBe('Q');
    expect(container.querySelector<HTMLAnchorElement>('.xf-tc-card')?.href).toBe('https://t.co/card');
    expect(container.querySelector('.xf-tc-card-domain')?.textContent).toBe('example.com');
  });

  it('drops links that are not http(s) and never opens an unsafe permalink', () => {
    const onOpen = draw({
      ...RICH,
      canonicalUrl: 'https://evil.example/alice/status/1',
      segments: [{ kind: 'link', text: 'x', url: 'javascript:alert(1)' }],
      media: [],
      card: { url: 'javascript:alert(1)', layout: 'large', title: 't', domain: null, imageUrl: null },
    });
    expect(container.querySelector('.xf-tc-text a')).toBeNull();
    expect(container.querySelector('.xf-tc-card')).toBeNull();
    expect(container.querySelector('.xf-tc-time')).toBeNull();
    container.querySelector<HTMLElement>('.xf-tc-name')?.click();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('card formatting', () => {
  it('formats post times like X', () => {
    expect(formatPostedAt(NOW - 20_000, NOW)).toBe('20秒');
    expect(formatPostedAt(NOW - 5 * 60_000, NOW)).toBe('5分钟');
    expect(formatPostedAt(NOW - 3 * 3_600_000, NOW)).toBe('3小时');
    expect(formatPostedAt(new Date(2026, 8, 1).getTime(), NOW)).toBe('9月1日');
    expect(formatPostedAt(new Date(2025, 11, 31).getTime(), NOW)).toBe('2025年12月31日');
    expect(formatDay(new Date(2026, 0, 2).getTime(), NOW)).toBe('1月2日');
  });

  it('shortens link text as X does', () => {
    expect(displayLinkText('https://www.example.com/')).toBe('example.com/');
    expect(displayLinkText('example.com/short…')).toBe('example.com/short');
  });
});
