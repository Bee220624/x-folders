import { describe, expect, it } from 'vitest';
import {
  extractTweet,
  findIdentityAnchor,
  quoteSubtrees,
  type ExtractOutcome,
} from '@/hosts/x/TweetExtractor';
import { X_SELECTORS } from '@/hosts/x/selectors';
import { loadFixture, type FixtureName } from '../helpers/fixtures';

const NOW = 1_700_000_000_000;

function extractAll(name: FixtureName, pathname = '/home'): ExtractOutcome[] {
  const { tweets } = loadFixture(name);
  return tweets.map((root) => extractTweet(root, { pathname, now: NOW }));
}

describe('TweetExtractor against captured X DOM', () => {
  it('extracts every non-promoted tweet on the home timeline', () => {
    const outcomes = extractAll('x-home');
    expect(outcomes.length).toBeGreaterThan(5);

    const ok = outcomes.filter((o) => o.status === 'ok');
    const skipped = outcomes.filter((o) => o.status === 'skip');
    expect(ok.length).toBeGreaterThan(0);
    // The captured page contains promoted posts; they must be skipped, never
    // retried, or the watchdog re-scans them every 2 seconds forever.
    expect(skipped.every((o) => o.status === 'skip' && o.reason === 'promoted')).toBe(true);
    expect(outcomes.some((o) => o.status === 'retry')).toBe(false);

    for (const outcome of ok) {
      if (outcome.status !== 'ok') continue;
      expect(outcome.record.canonicalUrl).toMatch(
        /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/,
      );
      expect(outcome.record.tweetId).toMatch(/^\d+$/);
      expect(outcome.record.username.length).toBeGreaterThan(0);
    }
  });

  it('never returns an /analytics or /quotes URL as the identity', () => {
    for (const name of ['x-home', 'x-profile', 'x-search', 'x-status'] as const) {
      for (const outcome of extractAll(name, '/alice/status/1000000000000000001')) {
        if (outcome.status !== 'ok') continue;
        expect(outcome.record.canonicalUrl).not.toContain('/analytics');
        expect(outcome.record.canonicalUrl).not.toContain('/quotes');
      }
    }
  });

  it('finds the quoted-tweet subtree, which is not a nested tweet root', () => {
    const { tweets } = loadFixture('x-home');
    const withQuote = tweets.filter((root) => quoteSubtrees(root).length > 0);
    expect(withQuote.length).toBeGreaterThan(0);

    for (const root of withQuote) {
      const quotes = quoteSubtrees(root);
      // The premise the work order's guard relied on: there is no nested
      // [data-testid="tweet"], so closest() cannot separate the two tweets.
      expect(root.querySelectorAll(X_SELECTORS.tweetRoot)).toHaveLength(0);
      for (const quote of quotes) {
        const inner = quote.querySelector(X_SELECTORS.tweetText);
        if (inner !== null) expect(inner.closest(X_SELECTORS.tweetRoot)).toBe(root);
      }
    }
  });

  it('attributes a quote tweet to the outer author, not the quoted one', () => {
    const { tweets } = loadFixture('x-home');
    for (const root of tweets) {
      const quotes = quoteSubtrees(root);
      if (quotes.length === 0) continue;
      const outcome = extractTweet(root, { pathname: '/home', now: NOW });
      if (outcome.status !== 'ok') continue;

      const anchor = findIdentityAnchor(root, quotes);
      expect(anchor).not.toBeNull();
      // The chosen anchor must lie outside every quote subtree.
      for (const quote of quotes) expect(quote.contains(anchor)).toBe(false);

      // And the text must not have been taken from inside the quote.
      const quotedText = quotes[0]?.querySelector(X_SELECTORS.tweetText);
      if (quotedText !== null && quotedText !== undefined) {
        const quoted = quotedText.textContent ?? '';
        if (quoted.trim().length > 0 && outcome.record.text.length > 0) {
          expect(outcome.record.text).not.toBe(quoted.trim());
        }
      }
    }
  });

  it('extracts the subject tweet of a status page, whose header carries no time', () => {
    const { tweets } = loadFixture('x-status');
    const focused = tweets.find((root) => root.matches(X_SELECTORS.focusedTweet));
    expect(focused).toBeDefined();
    if (focused === undefined) return;

    // This is the case the work order's algorithm fails on: the focused tweet's
    // OWN User-Name block has no <time> in it, so "User-Name -> time -> closest
    // status link" yields nothing. (A descendant query would still match,
    // because this particular post quotes another one and the quote's header
    // does carry a time - which is exactly the trap.)
    const outerUserName = focused.querySelector(X_SELECTORS.userName);
    expect(outerUserName).not.toBeNull();
    expect(outerUserName?.querySelector('time')).toBeNull();

    const outcome = extractTweet(focused, {
      pathname: '/alice/status/1000000000000000001',
      now: NOW,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.record.tweetId).toMatch(/^\d+$/);
  });

  it('reads the identity from the href property, not the relative attribute', () => {
    const { tweets } = loadFixture('x-home');
    const root = tweets.find((candidate) => findIdentityAnchor(candidate, quoteSubtrees(candidate)));
    expect(root).toBeDefined();
    if (root === undefined) return;
    const anchor = findIdentityAnchor(root, quoteSubtrees(root));
    expect(anchor).not.toBeNull();
    // X emits relative hrefs; an absolute-URL regex over getAttribute would miss.
    expect(anchor?.getAttribute('href')?.startsWith('http')).toBe(false);
    expect(anchor?.href.startsWith('http')).toBe(true);
  });

  it('canonicalises twitter.com to x.com and keeps the URL username', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <span>Visible Name</span><span>@different_handle</span>
          <a href="https://twitter.com/urluser/status/1234567890"><time datetime="2026-01-01"></time></a>
        </div>
        <div data-testid="tweetText"><span>body</span></div>
      </article>`;
    const root = document.querySelector(X_SELECTORS.tweetRoot);
    expect(root).not.toBeNull();
    const outcome = extractTweet(root!, { pathname: '/home', now: NOW });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.record.canonicalUrl).toBe('https://x.com/urluser/status/1234567890');
    // The username is taken from the URL, never from the visible handle.
    expect(outcome.record.username).toBe('urluser');
  });

  it('preserves newlines and unicode but trims outer whitespace', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <span>Name</span>
          <a href="/u/status/1234567890"><time datetime="2026-01-01"></time></a>
        </div>
        <div data-testid="tweetText"><span>  line one</span><br><span>line two </span><img alt="EMOJI"></div>
      </article>`;
    const outcome = extractTweet(document.querySelector(X_SELECTORS.tweetRoot)!, {
      pathname: '/home',
      now: NOW,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.record.text).toBe('line one\nline two EMOJI');
  });

  it('returns an empty text for a media-only tweet without blocking the save', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <span>Name</span>
          <a href="/u/status/1234567890"><time datetime="2026-01-01"></time></a>
        </div>
        <div data-testid="tweetPhoto"><img alt=""></div>
      </article>`;
    const outcome = extractTweet(document.querySelector(X_SELECTORS.tweetRoot)!, {
      pathname: '/home',
      now: NOW,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.record.text).toBe('');
  });

  it('retries a half-rendered node but skips one that is rendered and unresolvable', () => {
    document.body.innerHTML = '<article data-testid="tweet"><div></div></article>';
    expect(
      extractTweet(document.querySelector(X_SELECTORS.tweetRoot)!, {
        pathname: '/home',
        now: NOW,
      }).status,
    ).toBe('retry');

    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><span>Deleted</span></div>
      </article>`;
    const outcome = extractTweet(document.querySelector(X_SELECTORS.tweetRoot)!, {
      pathname: '/home',
      now: NOW,
    });
    expect(outcome.status).toBe('skip');
    if (outcome.status === 'skip') expect(outcome.reason).toBe('no-permalink');
  });

  it('rejects a malformed status URL rather than storing it', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="https://evil.example/u/status/123"><time datetime="2026-01-01"></time></a>
        </div>
      </article>`;
    const outcome = extractTweet(document.querySelector(X_SELECTORS.tweetRoot)!, {
      pathname: '/home',
      now: NOW,
    });
    expect(outcome.status).toBe('skip');
  });

  it('keeps a post that carries X’s tracking marker but has a real permalink', () => {
    // Seen on real X on 2026-09-29: X attaches placementTracking to some
    // ordinary, unlabelled posts. Skipping on the marker alone made them
    // impossible to save.
    const { tweets } = loadFixture('x-home');
    const ordinary = tweets.find(
      (root) => extractTweet(root, { pathname: '/home', now: NOW }).status === 'ok',
    );
    expect(ordinary).toBeDefined();
    const marker = document.createElement('div');
    marker.setAttribute('data-testid', 'placementTracking');
    ordinary?.appendChild(marker);

    const outcome =
      ordinary === undefined ? null : extractTweet(ordinary, { pathname: '/home', now: NOW });
    expect(outcome?.status).toBe('ok');
  });
});
