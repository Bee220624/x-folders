import type { CleanupRegistry } from '@/utils/cleanup';

export type XTheme = 'light' | 'dim' | 'lightsOut';

export interface ThemeTokens {
  '--xf-bg': string;
  '--xf-bg-elevated': string;
  '--xf-text': string;
  '--xf-text-muted': string;
  '--xf-border': string;
  '--xf-hover': string;
  '--xf-accent': string;
  '--xf-accent-soft': string;
  '--xf-danger': string;
  '--xf-shadow': string;
  '--xf-font-family': string;
}

const FONT_STACK =
  '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ' +
  '"Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

/**
 * X exposes only its background colour in a way we are allowed to read: it is
 * written as an inline style on <body>. Text, border and hover colours live in
 * obfuscated `r-*` classes, which this project must not depend on — deriving
 * them from `getComputedStyle(body)` yields browser defaults (black text on a
 * Lights Out background), so the palettes below are pinned per theme instead.
 */
const PALETTES: Record<XTheme, ThemeTokens> = {
  light: {
    '--xf-bg': 'rgb(255, 255, 255)',
    '--xf-bg-elevated': 'rgb(255, 255, 255)',
    '--xf-text': 'rgb(15, 20, 25)',
    '--xf-text-muted': 'rgb(83, 100, 113)',
    '--xf-border': 'rgb(239, 243, 244)',
    '--xf-hover': 'rgba(15, 20, 25, 0.03)',
    '--xf-accent': 'rgb(29, 155, 240)',
    '--xf-accent-soft': 'rgba(29, 155, 240, 0.1)',
    '--xf-danger': 'rgb(244, 33, 46)',
    '--xf-shadow': 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px',
    '--xf-font-family': FONT_STACK,
  },
  dim: {
    '--xf-bg': 'rgb(21, 32, 43)',
    '--xf-bg-elevated': 'rgb(30, 39, 50)',
    '--xf-text': 'rgb(247, 249, 249)',
    '--xf-text-muted': 'rgb(139, 152, 165)',
    '--xf-border': 'rgb(56, 68, 77)',
    '--xf-hover': 'rgba(247, 249, 249, 0.03)',
    '--xf-accent': 'rgb(29, 155, 240)',
    '--xf-accent-soft': 'rgba(29, 155, 240, 0.1)',
    '--xf-danger': 'rgb(244, 33, 46)',
    '--xf-shadow': 'rgba(255, 255, 255, 0.2) 0px 0px 15px, rgba(255, 255, 255, 0.15) 0px 0px 3px 1px',
    '--xf-font-family': FONT_STACK,
  },
  lightsOut: {
    '--xf-bg': 'rgb(0, 0, 0)',
    '--xf-bg-elevated': 'rgb(22, 24, 28)',
    '--xf-text': 'rgb(231, 233, 234)',
    '--xf-text-muted': 'rgb(113, 118, 123)',
    '--xf-border': 'rgb(47, 51, 54)',
    '--xf-hover': 'rgba(231, 233, 234, 0.03)',
    '--xf-accent': 'rgb(29, 155, 240)',
    '--xf-accent-soft': 'rgba(29, 155, 240, 0.1)',
    '--xf-danger': 'rgb(244, 33, 46)',
    '--xf-shadow': 'rgba(255, 255, 255, 0.2) 0px 0px 15px, rgba(255, 255, 255, 0.15) 0px 0px 3px 1px',
    '--xf-font-family': FONT_STACK,
  },
};

function parseRgb(value: string): [number, number, number] | null {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (match === null) return null;
  const [, r, g, b] = match;
  if (r === undefined || g === undefined || b === undefined) return null;
  return [Number(r), Number(g), Number(b)];
}

/** Classifies by luminance so an unexpected X palette still lands somewhere sane. */
export function detectTheme(doc: Document = document): XTheme {
  const inline = doc.body?.style.backgroundColor ?? '';
  const computed =
    inline.length > 0 ? inline : (doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? '');
  const rgb = parseRgb(computed);
  if (rgb === null) {
    const prefersDark = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark === true ? 'lightsOut' : 'light';
  }
  const [r, g, b] = rgb;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance > 128) return 'light';
  // Dim is a blue-grey; Lights Out is neutral near-black.
  return luminance > 12 || b - r > 8 ? 'dim' : 'lightsOut';
}

export function tokensFor(theme: XTheme): ThemeTokens {
  return PALETTES[theme];
}

/**
 * Applies theme tokens to every registered shadow host and keeps them in sync.
 * Only the extension's own hosts are written to; X's variables are never
 * modified and no global style is injected into the page.
 */
export class ThemeAdapter {
  #theme: XTheme;
  readonly #targets = new Set<HTMLElement>();
  readonly #listeners = new Set<(theme: XTheme) => void>();

  constructor(private readonly doc: Document = document) {
    this.#theme = detectTheme(doc);
  }

  get theme(): XTheme {
    return this.#theme;
  }

  register(target: HTMLElement): () => void {
    this.#targets.add(target);
    this.#apply(target);
    return () => this.#targets.delete(target);
  }

  onChange(listener: (theme: XTheme) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  attach(registry: CleanupRegistry): void {
    const observer = new MutationObserver(() => this.refresh());
    // A narrow attribute filter: X rewrites body's inline style on theme change,
    // and toggles classes on <html>. Watching childList here would fire on every
    // timeline update for no benefit.
    observer.observe(this.doc.body, { attributes: true, attributeFilter: ['style', 'class'] });
    observer.observe(this.doc.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-color-mode', 'data-nightmode'],
    });
    registry.addObserver(observer);

    const media = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
    if (media !== undefined) {
      const onMedia = (): void => this.refresh();
      media.addEventListener('change', onMedia);
      registry.add(() => media.removeEventListener('change', onMedia));
    }
    registry.add(() => {
      this.#targets.clear();
      this.#listeners.clear();
    });
  }

  refresh(): void {
    const next = detectTheme(this.doc);
    if (next === this.#theme) return;
    this.#theme = next;
    for (const target of this.#targets) this.#apply(target);
    for (const listener of this.#listeners) listener(next);
  }

  #apply(target: HTMLElement): void {
    for (const [name, value] of Object.entries(PALETTES[this.#theme])) {
      target.style.setProperty(name, value);
    }
  }
}
