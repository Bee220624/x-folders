import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cardHtml, postHtml, quoteHtml } from '../helpers/postDom';
import { findLeaks } from '../helpers/sanitizedCheck';

interface Capture {
  reset(): void;
  grab(): { added: number; total: number };
  html(): string;
}

let capture: Capture;

beforeAll(() => {
  // The script is written for an x.com page; run it in jsdom's window the same way.
  const source = readFileSync(resolve(process.cwd(), 'tools/capture-fixture.js'), 'utf8');
  new Function(source)();
  capture = (window as unknown as { __xfCapture: Capture }).__xfCapture;
});

const REAL_POST = postHtml({
  id: '1839990000000000123',
  user: 'RealPerson',
  name: 'Real Person Name',
  verified: true,
  avatar: 'https://pbs.twimg.com/profile_images/1771234567/Ab_c9Xyz_normal.jpg',
  textHtml:
    '<span>secret words </span><div><span><a href="/SomeFriend">@SomeFriend</a></span></div>' +
    '<a href="https://t.co/Zq9Real">https://private.example.org/path</a>' +
    '<span><a href="/hashtag/Private?src=hashtag_click">#Private</a></span>' +
    '<img alt="😀" src="https://abs-0.twimg.com/emoji/v2/svg/1f600.svg">',
  photos: ['https://pbs.twimg.com/media/GZsecretKey?format=jpg&name=900x900'],
  cardHtml: cardHtml({ href: 'https://t.co/CardReal', domainLine: '来自 private.example.org', title: 'Private headline' }),
  quoteHtml: quoteHtml({ user: 'QuotedReal', name: 'Quoted Real', text: 'quoted secret' }),
});

function capturedPage(): Document {
  return new DOMParser().parseFromString(capture.html(), 'text/html');
}

beforeEach(() => {
  document.body.innerHTML =
    '<header role="banner"><nav><a href="/home" aria-label="Home">首页</a><a href="/RealPerson">Profile</a></nav></header>' +
    '<main><div data-testid="primaryColumn"><section><div>' +
    `<div data-testid="cellInnerDiv" style="transform: translateY(0px);">${REAL_POST}</div>` +
    '</div></section></div></main>';
  capture.reset();
  capture.grab();
});

describe('tools/capture-fixture.js', () => {
  it('keeps the structure our selectors need', () => {
    const doc = capturedPage();
    for (const testid of [
      'primaryColumn',
      'cellInnerDiv',
      'tweet',
      'User-Name',
      'Tweet-User-Avatar',
      'tweetText',
      'tweetPhoto',
      'card.wrapper',
      'icon-verified',
    ]) {
      expect(doc.querySelector(`[data-testid="${testid}"]`), testid).not.toBeNull();
    }
    expect(doc.querySelector('#react-root header[role="banner"] nav')).not.toBeNull();
    expect(doc.querySelector('div[role="link"][tabindex="0"]')).not.toBeNull();
  });

  it('leaks no real name, id, text, link or picture name', () => {
    const out = capture.html();
    for (const secret of [
      'RealPerson',
      'Real Person Name',
      '1839990000000000123',
      'SomeFriend',
      'secret',
      'Zq9Real',
      'private.example.org',
      'Private',
      'GZsecretKey',
      '1771234567',
      'Ab_c9Xyz',
      'CardReal',
      'QuotedReal',
      '首页',
      'Profile',
      'translateY',
    ]) {
      expect(out, secret).not.toContain(secret);
    }
    expect(findLeaks(out)).toEqual([]);
  });

  it('maps a handle and its links to the same synthetic user, and a post to one synthetic id', () => {
    const doc = capturedPage();
    const mention = doc.querySelector('[data-testid="tweetText"] a[href^="/user"]');
    expect(mention?.textContent).toBe(`@${mention?.getAttribute('href')?.slice(1) ?? ''}`);
    const permalink = doc.querySelector('[data-testid="User-Name"] a[href*="/status/"]')?.getAttribute('href') ?? '';
    expect(permalink).toMatch(/^\/user\d+\/status\/10{8,}\d+$/);
    const photoLink = doc.querySelector('[data-testid="tweetPhoto"] a')?.getAttribute('href') ?? '';
    expect(photoLink.startsWith(`${permalink}/photo/`)).toBe(true);
  });

  it('leaves out what the extension itself mounted on the page', () => {
    const withExtension = REAL_POST.replace(
      '<div role="group">',
      '<div role="group"><div data-xf-action-host="" data-xf-tweet-id="1839990000000000123"></div>',
    ).replace('<article data-testid="tweet"', '<article data-xf-skip="promoted" data-testid="tweet"');
    document.body.innerHTML =
      '<header role="banner"><nav><div data-xf-sidebar-host=""><span>我的收藏</span></div></nav></header>' +
      '<main><div data-testid="primaryColumn"><section><div>' +
      `<div data-testid="cellInnerDiv">${withExtension}</div>` +
      '</div></section></div></main>';
    capture.reset();
    capture.grab();
    const out = capture.html();
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect(out).not.toContain('data-xf-');
    expect(doc.querySelector('header nav')?.children).toHaveLength(0);
    expect(doc.querySelector('[role="group"]')?.children).toHaveLength(3);
    // X's own post stays, only our marker attribute is gone.
    expect(doc.querySelector('article[data-testid="tweet"]')).not.toBeNull();
    expect(findLeaks(out)).toEqual([]);
  });
});
