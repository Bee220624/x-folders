import { describe, expect, it } from 'vitest';
import {
  avatarUrlForDisplay,
  imageUrlForSize,
  isAllowedImageUrl,
  isAllowedLinkUrl,
  normalizeImageUrl,
} from '@/utils/url';

describe('image allow-list (work order 3.2)', () => {
  it('accepts only https://pbs.twimg.com', () => {
    expect(isAllowedImageUrl('https://pbs.twimg.com/media/A?format=jpg&name=small')).toBe(true);
    expect(isAllowedImageUrl('http://pbs.twimg.com/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://pbs.twimg.com.evil.example/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://evil.example/pbs.twimg.com/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://user@pbs.twimg.com/media/A')).toBe(false);
    expect(isAllowedImageUrl('https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png')).toBe(false);
    expect(isAllowedImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isAllowedImageUrl('not a url')).toBe(false);
  });
});

describe('link allow-list (work order 3.2)', () => {
  it('accepts http and https only', () => {
    expect(isAllowedLinkUrl('https://t.co/abc')).toBe(true);
    expect(isAllowedLinkUrl('http://example.com/')).toBe(true);
    expect(isAllowedLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedLinkUrl('data:text/html,hi')).toBe(false);
    expect(isAllowedLinkUrl('blob:https://x.com/1')).toBe(false);
  });
});

describe('image URL shapes', () => {
  it('stores one URL per photo whatever size the page asked for', () => {
    expect(normalizeImageUrl('https://pbs.twimg.com/media/AbC?format=jpg&name=900x900')).toBe(
      'https://pbs.twimg.com/media/AbC?format=jpg&name=small',
    );
    expect(normalizeImageUrl('https://pbs.twimg.com/media/AbC?name=large&format=png')).toBe(
      'https://pbs.twimg.com/media/AbC?format=png&name=small',
    );
  });

  it('stores the 48px avatar rendition', () => {
    expect(normalizeImageUrl('https://pbs.twimg.com/profile_images/1/a_400x400.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    );
  });

  it('leaves video posters and card images alone', () => {
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1/img/abc.jpg';
    const card = 'https://pbs.twimg.com/card_img/1/abc?format=jpg&name=800x419';
    expect(normalizeImageUrl(poster)).toBe(poster);
    expect(normalizeImageUrl(card)).toBe(card);
  });

  it('asks for a display size only where X supports one', () => {
    expect(imageUrlForSize('https://pbs.twimg.com/media/AbC?format=jpg&name=small', 'medium')).toBe(
      'https://pbs.twimg.com/media/AbC?format=jpg&name=medium',
    );
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1/img/abc.jpg';
    expect(imageUrlForSize(poster, 'medium')).toBe(poster);
    expect(avatarUrlForDisplay('https://pbs.twimg.com/profile_images/1/a_normal.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/a_bigger.jpg',
    );
  });
});
