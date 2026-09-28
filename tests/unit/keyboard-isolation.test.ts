import { afterEach, describe, expect, it } from 'vitest';
import { ThemeAdapter } from '@/hosts/x/ThemeAdapter';
import { TweetActionInjector } from '@/hosts/x/TweetActionInjector';
import { createShadowHost } from '@/ui/shared/ShadowHost';
import { CleanupRegistry } from '@/utils/cleanup';
import { loadFixture } from '../helpers/fixtures';

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/** Stands in for X's page-level shortcut handler (bubble phase on document). */
function listenLikeThePage(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const record = (event: Event): void => {
    seen.push(`${event.type}:${(event as KeyboardEvent).key}`);
  };
  for (const type of KEY_EVENTS) document.addEventListener(type, record);
  return {
    seen,
    stop: () => {
      for (const type of KEY_EVENTS) document.removeEventListener(type, record);
    },
  };
}

function press(target: EventTarget, key: string): void {
  for (const type of KEY_EVENTS) {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, composed: true }));
  }
}

describe('keyboard isolation', () => {
  let registry: CleanupRegistry | undefined;
  let page: ReturnType<typeof listenLikeThePage> | undefined;

  afterEach(() => {
    page?.stop();
    registry?.dispose();
    page = undefined;
    registry = undefined;
    document.body.innerHTML = '';
  });

  it('keeps keys typed into our UI away from page-level listeners', () => {
    registry = new CleanupRegistry();
    page = listenLikeThePage();
    const handle = createShadowHost({
      marker: 'data-xf-test-host',
      css: '',
      theme: new ThemeAdapter(),
      registry,
    });
    document.body.appendChild(handle.host);
    const input = document.createElement('input');
    handle.mount.appendChild(input);
    const seenByInput: string[] = [];
    input.addEventListener('keydown', (event) => seenByInput.push(event.key));

    for (const key of ['n', 'r', 't', 'l', 'j', 'k', 'Enter']) press(input, key);

    expect(seenByInput).toEqual(['n', 'r', 't', 'l', 'j', 'k', 'Enter']);
    expect(page.seen).toEqual([]);
  });

  it('leaves the page’s own keyboard handling alone', () => {
    page = listenLikeThePage();
    press(document.body, 'j');
    expect(page.seen).toEqual(['keydown:j', 'keypress:j', 'keyup:j']);
  });

  it('keeps keys pressed on an injected tweet button away from the page', () => {
    const { tweets } = loadFixture('x-home');
    page = listenLikeThePage();
    const injector = new TweetActionInjector(() => {});
    const result = tweets
      .map((tweet) => injector.ensure(tweet, { tweetId: '1', savedCount: 0 }))
      .find((candidate) => candidate !== null);
    const button = TweetActionInjector.buttonFor(result?.host);
    expect(button).not.toBeNull();

    if (button !== null) press(button, 'Enter');

    expect(page.seen).toEqual([]);
  });
});
