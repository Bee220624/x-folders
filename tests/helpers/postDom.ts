/**
 * Hand-built X post markup shaped after the structure measured on real x.com
 * on 2026-09-29 (see the M2 plan). Only what our selectors read is present;
 * X's class names and styles are left out, as in the captured fixtures.
 */

const BADGE =
  '<span><svg data-testid="icon-verified" role="img" aria-label="LABEL"><path d="M0 0h24v24H0z"></path></svg></span>';

export interface PostOptions {
  id?: string;
  user?: string;
  name?: string;
  verified?: boolean;
  /** The avatar picture; null leaves it unloaded, as in a background tab. */
  avatar?: string | null;
  /** X paints avatars as an <img> and as a CSS background; either may come first. */
  avatarAs?: 'img' | 'background';
  datetime?: string;
  /** Inner HTML of tweetText; null leaves the block out (a media-only post). */
  textHtml?: string | null;
  showMore?: boolean;
  photos?: readonly string[];
  video?: { poster: string };
  cardHtml?: string;
  quoteHtml?: string;
  /** A post's own page: tabindex -1 and the time in a permalink row under the body. */
  focused?: boolean;
}

export function postHtml(options: PostOptions = {}): string {
  const id = options.id ?? '1234567890';
  const user = options.user ?? 'alice';
  const focused = options.focused === true;
  const avatar =
    options.avatar === undefined ? `https://pbs.twimg.com/profile_images/1/${user}_normal.jpg` : options.avatar;
  let avatarPaint = '';
  if (avatar !== null) {
    avatarPaint =
      options.avatarAs === 'background'
        ? `<div style="background-image: url(&quot;${avatar}&quot;);"></div>`
        : `<img alt="" draggable="true" src="${avatar}">`;
  }
  const time =
    `<a href="/${user}/status/${id}" role="link">` +
    `<time datetime="${options.datetime ?? '2026-09-28T10:00:00.000Z'}">3小时</time></a>`;
  const photos = (options.photos ?? [])
    .map(
      (src, index) =>
        `<div data-testid="tweetPhoto"><a href="/${user}/status/${id}/photo/${index + 1}">` +
        `<div><img alt="图像" src="${src}"></div></a></div>`,
    )
    .join('');
  const video =
    options.video === undefined
      ? ''
      : '<div data-testid="tweetPhoto"><div><div data-testid="placementTracking">' +
        '<div data-testid="videoPlayer"><div><div data-testid="videoComponent">' +
        `<video tabindex="-1" poster="${options.video.poster}" src="blob:https://x.com/0"></video>` +
        `<div><img alt="" src="${options.video.poster}"></div>` +
        '</div></div></div></div></div></div>';
  const text =
    options.textHtml === null
      ? ''
      : `<div data-testid="tweetText" dir="auto">${options.textHtml ?? '<span>hello</span>'}</div>`;
  const showMore =
    options.showMore === true
      ? '<button data-testid="tweet-text-show-more-link" role="button" type="button"><span>显示更多</span></button>'
      : '';
  return (
    `<article data-testid="tweet" role="article" tabindex="${focused ? '-1' : '0'}">` +
    `<div data-testid="Tweet-User-Avatar"><div data-testid="UserAvatar-Container-${user}">` +
    `<a href="/${user}" role="link" tabindex="-1" aria-hidden="true">${avatarPaint}</a></div></div>` +
    '<div data-testid="User-Name">' +
    `<a href="/${user}" role="link"><div><span><span>${options.name ?? 'Alice'}</span></span>` +
    `${options.verified === true ? BADGE : ''}</div></a>` +
    `<div><a href="/${user}" role="link" tabindex="-1"><span>@${user}</span></a>` +
    `<div aria-hidden="true"><span>·</span></div>${focused ? '' : time}</div>` +
    '</div>' +
    text +
    showMore +
    photos +
    video +
    (options.cardHtml ?? '') +
    (options.quoteHtml ?? '') +
    (focused ? `<div>${time}</div>` : '') +
    '<div role="group"><div><button data-testid="reply"></button></div>' +
    '<div><button data-testid="retweet"></button></div><div><button data-testid="like"></button></div></div>' +
    '</article>'
  );
}

export interface QuoteOptions {
  user?: string;
  name?: string;
  verified?: boolean;
  avatar?: string | null;
  text?: string;
  photo?: string;
  /** Sensitive media: X covers it and renders no picture. */
  interstitial?: boolean;
  datetime?: string;
  /** Older captures had a timestamped status link inside the quote; 2026-09-29 did not. */
  linkId?: string;
}

export function quoteHtml(options: QuoteOptions = {}): string {
  const user = options.user ?? 'quoted';
  const avatar =
    options.avatar === undefined ? `https://pbs.twimg.com/profile_images/2/${user}_normal.jpg` : options.avatar;
  const time = `<time datetime="${options.datetime ?? '2026-09-27T08:00:00.000Z'}">9月27日</time>`;
  const timeBlock =
    options.linkId === undefined
      ? `<div aria-label="LABEL">${time}</div>`
      : `<a href="/${user}/status/${options.linkId}" role="link">${time}</a>`;
  let media = '';
  if (options.interstitial === true) {
    media =
      '<div data-testid="testCondensedMedia"><div data-testid="tweetPhoto"><div>' +
      '<div data-testid="previewInterstitial" aria-label="LABEL"><span>内容警告</span></div></div></div></div>';
  } else if (options.photo !== undefined) {
    media =
      '<div data-testid="testCondensedMedia"><div data-testid="tweetPhoto">' +
      `<div><img alt="图像" src="${options.photo}"></div></div></div>`;
  }
  return (
    '<div role="link" tabindex="0"><div>' +
    `<div data-testid="Tweet-User-Avatar"><div data-testid="UserAvatar-Container-${user}">` +
    '<div role="presentation" tabindex="-1" aria-hidden="true">' +
    `${avatar === null ? '' : `<img alt="" src="${avatar}">`}</div></div></div>` +
    '<div data-testid="User-Name">' +
    `<div><span><span>${options.name ?? 'Quoted Person'}</span></span>${options.verified === true ? BADGE : ''}</div>` +
    `<div><div tabindex="-1"><span>@${user}</span></div><div aria-hidden="true"><span>·</span></div>${timeBlock}</div>` +
    '</div></div>' +
    `<div>${media}<div data-testid="tweetText" dir="auto"><span>${options.text ?? 'quoted words'}</span></div></div>` +
    '</div>'
  );
}

export interface CardOptions {
  layout?: 'large' | 'small';
  href?: string;
  /** null: a card without a picture. */
  image?: string | null;
  domainLine?: string;
  title?: string;
}

/**
 * A link preview. The test ids come from the 2026-09-03 capture; the text
 * lines inside are an assumption until Task 14's capture confirms them.
 */
export function cardHtml(options: CardOptions = {}): string {
  const href = options.href ?? 'https://t.co/card';
  const media = options.layout === 'small' ? 'card.layoutSmall.media' : 'card.layoutLarge.media';
  const image =
    options.image === undefined ? 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=small' : options.image;
  const link = `<a href="${href}" rel="noopener noreferrer nofollow" target="_blank" role="link">`;
  return (
    '<div data-testid="card.wrapper">' +
    `<div data-testid="${media}">${link}${image === null ? '' : `<div><img alt="" src="${image}"></div>`}` +
    `<div><span>${options.domainLine ?? '来自 example.com'}</span></div></a></div>` +
    `${link}<div><span>${options.title ?? 'A card title'}</span></div></a>` +
    '</div>'
  );
}

/** Replaces the document body with `html` and returns its first post. */
export function mountPost(html: string): HTMLElement {
  document.body.innerHTML = html;
  const root = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
  if (root === null) throw new Error('no post root in the markup');
  return root;
}
