/**
 * X Folders — page sample capture (work order 3.3 rule 2).
 *
 * Runs inside a logged-in x.com tab (the M2 plan does it through Claude in
 * Chrome's javascript tool). Read-only: it scrolls and clones, never clicks.
 * Everything is sanitised inside the page — default-deny — so no real
 * username, post id, text or picture name ever leaves the browser:
 *   - text becomes synthetic ("示例文字…") of the same length; handles,
 *     hashtags and domains become their mapped synthetic forms;
 *   - attributes are allow-listed; class, id, lang, style (but a rewritten
 *     background picture) and data-* (but data-testid) are dropped;
 *   - links, pictures, test ids and times become synthetic values, consistent
 *     within one run, so a post keeps its id across the pages captured;
 *   - script, style, iframe and similar elements are removed, and so is
 *     everything the extension itself mounted on the page.
 *
 * window.__xfCapture:
 *   sanitize(node)          a sanitised deep clone
 *   grab()                  add the timeline rows now mounted
 *   collect({ scrolls })    scroll and grab; resolves with coverage()
 *   coverage()              what the collected rows contain
 *   reset()                 drop the collected rows, keep the id maps
 *   go(path)                in-app navigation that keeps this object alive
 *   openLongPost()          go to the first collected "Show more" post; returns its synthetic id
 *   html()                  the fixture document
 *   download(name)          save html() as a file (ask the user first)
 */
window.__xfCapture = (() => {
  'use strict';

  const SYNTH = '示例文字';
  const EMOJI_SRC = 'https://abs-0.twimg.com/emoji/v2/svg/1f642.svg';
  const DEFAULT_AVATAR = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_PATH = 'M0 0h24v24H0z';
  const BASE_TIME = Date.UTC(2026, 0, 1);
  const HOUR_MS = 3600000;
  const QUOTE = 'div[role="link"][tabindex="0"]';
  /** The extension's own mounts (buttons, sidebar, overlay, popover) are not part of X's page. */
  const OWN_HOST = /^data-xf-.*-host$/;

  const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
  const KEEP_ATTRS = new Set([
    'data-testid', 'role', 'tabindex', 'aria-hidden', 'dir', 'type', 'target', 'rel', 'draggable',
    'aria-haspopup', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-disabled', 'aria-live',
    'aria-orientation', 'aria-multiselectable', 'viewBox',
  ]);
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'LINK', 'META', 'TEMPLATE', 'OBJECT', 'EMBED', 'SOURCE', 'TRACK', 'CANVAS',
  ]);
  const KEEP_FIRST = new Set([
    'home', 'explore', 'notifications', 'messages', 'settings', 'compose', 'i', 'jobs', 'communities',
    'premium_sign_up', 'verified-choose', 'lists', 'bookmarks', 'tos', 'privacy', 'logout', 'account', 'grok',
  ]);
  const PATH_WORDS = new Set([
    'status', 'photo', 'video', 'analytics', 'quotes', 'retweets', 'likes', 'history', 'with_replies', 'media',
    'highlights', 'articles', 'followers', 'following', 'verified_followers', 'lists', 'communities', 'header_photo',
  ]);
  const IMAGE_KINDS = {
    media: 'media',
    profile_images: 'avatar',
    amplify_video_thumb: 'video',
    ext_tw_video_thumb: 'video',
    tweet_video_thumb: 'gif',
    card_img: 'card',
    semantic_core_img: 'topic',
    profile_banners: 'banner',
    ad_img: 'ad',
    news_img: 'news',
  };
  const IMAGE_SUFFIX = /(?:_(?:normal|bigger|mini|x96|200x200|400x400|reasonably_small))?(?:\.(?:jpe?g|png|webp|gif))?$/i;
  const HANDLE_TEXT = /^(\s*)@([A-Za-z0-9_]{1,15})(\s*)$/;
  const TAG_TEXT = /^(\s*)([#$])(\S+?)(\s*)$/u;
  const DOMAIN_TEXT = /^(\s*)(?:(\S+)\s+)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(\s*)$/i;

  const sequences = new Map();
  const rows = new Map();

  function seq(kind, key) {
    let map = sequences.get(kind);
    if (map === undefined) {
      map = new Map();
      sequences.set(kind, map);
    }
    if (!map.has(key)) map.set(key, map.size + 1);
    return map.get(key);
  }

  function mapUser(name) {
    return `user${seq('user', name.toLowerCase())}`;
  }

  function mapId(id) {
    return String(10n ** 18n + BigInt(seq('id', id)));
  }

  function decode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function synth(text) {
    let index = 0;
    return text.replace(/\S/gu, () => SYNTH[index++ % SYNTH.length]);
  }

  function rewriteHref(raw) {
    let url;
    try {
      url = new URL(raw, 'https://x.com');
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname === 't.co') return `https://t.co/fixture${seq('tco', url.pathname)}`;
    if (!X_HOSTS.has(url.hostname)) return `https://example.com/fixture${seq('ext', url.href)}`;
    const segs = url.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return '/';
    const first = segs[0];
    const rest = segs.slice(1);
    if (first === 'hashtag') return `/hashtag/tag${seq('tag', decode(rest[0] || '').toLowerCase())}`;
    if (first === 'search') return '/search?q=fixture';
    if (KEEP_FIRST.has(first)) {
      return `/${segs.map((s) => (/^\d+$/.test(s) ? '1' : /^[a-z_-]{1,30}$/.test(s) ? s : 'x')).join('/')}`;
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return '/';
    const out = [mapUser(first)];
    for (let i = 0; i < rest.length; i += 1) {
      const s = rest[i];
      if (/^\d+$/.test(s)) out.push(rest[i - 1] === 'status' ? mapId(s) : '1');
      else out.push(PATH_WORDS.has(s) ? s : 'x');
    }
    return `/${out.join('/')}`;
  }

  function rewriteImage(raw) {
    let url;
    try {
      url = new URL(raw, location.href);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'abs-0.twimg.com' && url.pathname.startsWith('/emoji/')) return EMOJI_SRC;
    if (url.hostname === 'abs.twimg.com' && url.pathname.startsWith('/sticky/default_profile_images/')) {
      return DEFAULT_AVATAR;
    }
    if (url.hostname !== 'pbs.twimg.com') return null;
    const segs = url.pathname.split('/').filter(Boolean);
    const kind = segs.length >= 2 && /^[a-z_]{1,30}$/.test(segs[0]) ? segs[0] : 'x';
    const file = segs[segs.length - 1] || '';
    const suffix = IMAGE_SUFFIX.exec(file)[0];
    const middle = segs.slice(1, -1).map((s) => (/^\d+$/.test(s) ? '1' : s === 'img' || s === 'pu' ? s : 'x'));
    const name = `fixture-${IMAGE_KINDS[kind] || 'image'}-${seq('img', url.pathname)}${suffix}`;
    const params = new URLSearchParams();
    for (const key of ['format', 'name']) {
      const value = url.searchParams.get(key);
      if (value !== null && /^[a-z0-9]{1,12}$/i.test(value)) params.set(key, value);
    }
    const query = params.toString();
    return `https://pbs.twimg.com/${[kind, ...middle, name].join('/')}${query ? `?${query}` : ''}`;
  }

  function rewriteText(node) {
    const text = node.nodeValue || '';
    if (!/\S/.test(text)) return;
    const inLink = node.parentElement !== null && node.parentElement.closest('a') !== null;
    let match = HANDLE_TEXT.exec(text);
    if (match) {
      node.nodeValue = `${match[1]}@${mapUser(match[2])}${match[3]}`;
      return;
    }
    match = inLink ? TAG_TEXT.exec(text) : null;
    if (match) {
      node.nodeValue = `${match[1]}${match[2]}tag${seq('tag', match[3].toLowerCase())}${match[4]}`;
      return;
    }
    match = DOMAIN_TEXT.exec(text);
    if (match) {
      node.nodeValue = `${match[1]}${match[2] ? `${synth(match[2])} ` : ''}example.com${match[4]}`;
      return;
    }
    node.nodeValue = synth(text);
  }

  function rewriteAttributes(el, inText) {
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name;
      const value = attribute.value;
      let next = null;
      if (name === 'data-testid') {
        next = value.startsWith('UserAvatar-Container-')
          ? `UserAvatar-Container-${mapUser(value.slice('UserAvatar-Container-'.length))}`
          : value.replace(/\d{5,}/g, (digits) => mapId(digits));
      } else if (name === 'href') {
        next = rewriteHref(value);
      } else if (name === 'src' || name === 'poster') {
        next = rewriteImage(value);
      } else if (name === 'datetime') {
        next = new Date(BASE_TIME - seq('time', value) * HOUR_MS).toISOString();
      } else if (name === 'alt') {
        next = value === '' ? '' : inText ? '🙂' : 'ALT';
      } else if (name === 'aria-label') {
        next = 'LABEL';
      } else if (name === 'style') {
        const found = /url\(["']?(.*?)["']?\)/.exec(el.style ? el.style.backgroundImage : '');
        const image = found ? rewriteImage(found[1]) : null;
        next = image === null ? null : `background-image: url("${image}");`;
      } else if (name === 'd' && el.tagName.toLowerCase() === 'path') {
        next = SVG_PATH;
      } else if (KEEP_ATTRS.has(name) && /^[\w .:-]{0,40}$/.test(value)) {
        next = value;
      }
      if (next === null) el.removeAttribute(name);
      else if (next !== value) el.setAttribute(name, next);
    }
  }

  function resetSvg(svg) {
    while (svg.firstChild !== null) svg.firstChild.remove();
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', SVG_PATH);
    svg.appendChild(path);
  }

  function sanitizeInPlace(root) {
    const walk = (el, inText) => {
      if (DROP_TAGS.has(el.tagName.toUpperCase())) {
        el.remove();
        return;
      }
      if (Array.from(el.attributes).some((attribute) => OWN_HOST.test(attribute.name))) {
        el.remove();
        return;
      }
      const textBlock = inText || el.getAttribute('data-testid') === 'tweetText';
      rewriteAttributes(el, textBlock);
      if (el.namespaceURI === SVG_NS && el.tagName.toLowerCase() === 'svg') {
        resetSvg(el);
        return;
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.removeAttribute('value');
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) rewriteText(child);
        else if (child.nodeType === Node.ELEMENT_NODE) walk(child, textBlock);
        else child.remove();
      }
    };
    walk(root, false);
    return root;
  }

  function sanitize(node) {
    return sanitizeInPlace(node.cloneNode(true));
  }

  function permalinkOf(cell) {
    for (const a of cell.querySelectorAll('a[href*="/status/"]')) {
      if (a.closest(QUOTE) === null && a.querySelector('time') !== null) return a.getAttribute('href');
    }
    return null;
  }

  function grab() {
    let added = 0;
    for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      if (cell.querySelector('article[data-testid="tweet"]') === null) continue;
      const key =
        permalinkOf(cell) || `ad:${cell.querySelectorAll('*').length}:${(cell.textContent || '').length}`;
      if (rows.has(key)) continue;
      rows.set(key, sanitize(cell));
      added += 1;
    }
    return { added, total: rows.size };
  }

  function coverage() {
    const out = {
      posts: 0, photo1: 0, photo2: 0, photo3: 0, photo4: 0, video: 0, gif: 0, cardLarge: 0, cardSmall: 0,
      quote: 0, quoteMedia: 0, showMore: 0, promoted: 0, avatar: 0, verified: 0,
    };
    for (const row of rows.values()) {
      const post = row.querySelector('article[data-testid="tweet"]');
      if (post === null) continue;
      out.posts += 1;
      const quote = post.querySelector(QUOTE);
      const own = (selector) =>
        Array.from(post.querySelectorAll(selector)).filter((el) => quote === null || !quote.contains(el));
      const stills = own('[data-testid="tweetPhoto"]').filter(
        (cell) => cell.querySelector('video') === null && cell.querySelector('img[src]') !== null,
      );
      if (stills.length > 0) out[`photo${Math.min(stills.length, 4)}`] += 1;
      for (const video of own('video')) {
        if (String(video.getAttribute('poster')).includes('/tweet_video_thumb/')) out.gif += 1;
        else out.video += 1;
      }
      if (own('[data-testid="card.layoutSmall.media"]').length > 0) out.cardSmall += 1;
      else if (own('[data-testid="card.wrapper"]').length > 0) out.cardLarge += 1;
      if (quote !== null) {
        out.quote += 1;
        if (quote.querySelector('img[src*="/media/"], video') !== null) out.quoteMedia += 1;
      }
      if (own('[data-testid="tweet-text-show-more-link"]').length > 0) out.showMore += 1;
      if (post.querySelector('[data-testid="placementTracking"]') !== null && permalinkOf(row) === null) {
        out.promoted += 1;
      }
      if (own('[data-testid="Tweet-User-Avatar"] img[src*="/profile_images/"]').length > 0) out.avatar += 1;
      if (own('[data-testid="icon-verified"]').length > 0) out.verified += 1;
    }
    return out;
  }

  async function collect({ scrolls = 10, delayMs = 1200 } = {}) {
    for (let i = 0; i < scrolls; i += 1) {
      grab();
      scrollBy(0, innerHeight * 1.5);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    grab();
    return coverage();
  }

  function reset() {
    rows.clear();
  }

  function go(path) {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    return location.pathname.split('/').length;
  }

  function openLongPost() {
    for (const [key, row] of rows) {
      if (!key.startsWith('/') || row.querySelector('[data-testid="tweet-text-show-more-link"]') === null) continue;
      const id = /\/status\/(\d+)/.exec(key);
      if (id === null) continue;
      go(key.replace(/\/(?:photo|video)\/\d+$/, ''));
      return mapId(id[1]);
    }
    return null;
  }

  function html() {
    const background = document.body.style.backgroundColor || 'rgb(255, 255, 255)';
    const header = document.querySelector('header[role="banner"]');
    const column = document.querySelector('[data-testid="primaryColumn"]');
    const shell = column === null ? document.createElement('div') : column.cloneNode(true);
    const first = shell.querySelector('[data-testid="cellInnerDiv"]');
    const list = first === null ? shell : first.parentElement;
    for (const cell of Array.from(shell.querySelectorAll('[data-testid="cellInnerDiv"]'))) cell.remove();
    sanitizeInPlace(shell);
    for (const row of rows.values()) list.appendChild(row.cloneNode(true));
    const head = header === null ? '' : sanitize(header).outerHTML;
    return (
      '<!doctype html>\n<html lang="zh"><head><meta charset="utf-8"><title>X Folders fixture</title></head>' +
      `<body style="background-color: ${background};"><div id="react-root"><div><div>${head}` +
      `<main role="main"><div>${shell.outerHTML}</div></main></div></div></div></body></html>\n`
    );
  }

  function download(name) {
    const blob = new Blob([html()], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    return `${name}: ${blob.size} bytes`;
  }

  return { sanitize, grab, collect, coverage, reset, go, openLongPost, html, download };
})();
