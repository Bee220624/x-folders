/**
 * Default-deny review of a captured page (work order 3.3 rule 2): every
 * attribute, link, picture and text run must have one of the synthetic shapes
 * tools/capture-fixture.js produces. Returns what does not; an empty list
 * means the page may be committed.
 */

const SYNTHETIC_ID = '10{8,}\\d{1,9}';
const PATH_WORD =
  '(?:with_replies|media|likes|highlights|articles|followers|following|verified_followers|lists|' +
  `communities|header_photo|photo|video|status|analytics|quotes|retweets|history|x|1|${SYNTHETIC_ID})`;
const KEPT_FIRST =
  '(?:home|explore|notifications|messages|settings|compose|i|jobs|communities|premium_sign_up|' +
  'verified-choose|lists|bookmarks|tos|privacy|logout|account|grok)';

const HREF_SHAPES: readonly RegExp[] = [
  /^\/$/,
  new RegExp(`^/user\\d+(?:/${PATH_WORD})*$`),
  /^\/hashtag\/tag\d+$/,
  /^\/search\?q=fixture$/,
  new RegExp(`^/${KEPT_FIRST}(?:/(?:[a-z_-]{1,30}|1))*$`),
  /^https:\/\/t\.co\/fixture\d+$/,
  /^https:\/\/example\.com\/fixture\d+$/,
];

const IMAGE_SHAPES: readonly RegExp[] = [
  /^https:\/\/pbs\.twimg\.com\/[a-z_]{1,30}(?:\/(?:1|x|img|pu))*\/fixture-[a-z]+-\d+(?:_(?:normal|bigger|mini|x96|200x200|400x400|reasonably_small))?(?:\.(?:jpe?g|png|webp|gif))?(?:\?(?:format=[a-z0-9]{1,12}&name=[a-z0-9]{1,12}|format=[a-z0-9]{1,12}|name=[a-z0-9]{1,12}))?$/i,
  /^https:\/\/abs-0\.twimg\.com\/emoji\/v2\/svg\/1f642\.svg$/,
  /^https:\/\/abs\.twimg\.com\/sticky\/default_profile_images\/default_profile_normal\.png$/,
];

const SYNTHETIC_TEXT: readonly RegExp[] = [
  /^[\s示例文字]*$/u,
  /^\s*@user\d+\s*$/,
  /^\s*[#$]tag\d+\s*$/,
  /^\s*(?:[示例文字]+\s+)?example\.com\s*$/u,
];

const PLAIN_ATTRS: ReadonlySet<string> = new Set([
  'data-testid',
  'role',
  'tabindex',
  'aria-hidden',
  'dir',
  'type',
  'target',
  'rel',
  'draggable',
  'aria-haspopup',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-disabled',
  'aria-live',
  'aria-orientation',
  'aria-multiselectable',
  'viewBox',
]);

function styleOk(element: Element, value: string): boolean {
  if (element.tagName === 'BODY') return /^background-color: rgb\(\d{1,3}, \d{1,3}, \d{1,3}\);$/.test(value);
  const url = /^background-image: url\("([^"]+)"\);$/.exec(value)?.[1];
  return url !== undefined && IMAGE_SHAPES.some((shape) => shape.test(url));
}

function attributeOk(element: Element, name: string, value: string): boolean {
  switch (name) {
    case 'href':
      return HREF_SHAPES.some((shape) => shape.test(value));
    case 'src':
    case 'poster':
      return IMAGE_SHAPES.some((shape) => shape.test(value));
    case 'style':
      return styleOk(element, value);
    case 'datetime':
      return /^20\d\d-\d\d-\d\dT\d\d:00:00\.000Z$/.test(value);
    case 'alt':
      return value === '' || value === 'ALT' || value === '🙂';
    case 'aria-label':
      return value === 'LABEL';
    case 'd':
      return value === 'M0 0h24v24H0z';
    case 'id':
      return element.tagName === 'DIV' && value === 'react-root';
    case 'data-testid':
      return value.startsWith('UserAvatar-Container-')
        ? /^UserAvatar-Container-user\d+$/.test(value)
        : /^[\w.:-]{1,80}$/.test(value);
    default:
      return PLAIN_ATTRS.has(name) && /^[\w .:-]{0,40}$/.test(value);
  }
}

export function findLeaks(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const problems: string[] = [];
  for (const element of [doc.body, ...Array.from(doc.body.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!attributeOk(element, attribute.name, attribute.value)) {
        problems.push(`<${element.tagName.toLowerCase()} ${attribute.name}="${attribute.value.slice(0, 80)}">`);
      }
    }
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    if (!SYNTHETIC_TEXT.some((shape) => shape.test(text))) problems.push(`text ${JSON.stringify(text.slice(0, 80))}`);
  }
  const syntheticId = new RegExp(`^${SYNTHETIC_ID}$`);
  for (const [digits] of html.matchAll(/\d{7,}/g)) {
    if (!syntheticId.test(digits)) problems.push(`number ${digits}`);
  }
  return problems;
}
