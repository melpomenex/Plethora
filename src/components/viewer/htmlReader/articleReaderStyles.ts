import { SCHOLARLY_CLASS_TOKENS } from '../../../utils/articleImport/scholarlyContract';
import { readerThemeTokenCss, type ReaderThemeTokens } from './readerThemeTokens';

export interface ReaderTypographySettings {
  fontSize: number;
  lineHeight: number;
  fontFamily: 'serif' | 'sans-serif' | 'monospace' | string;
}

const FONT_FAMILIES: Record<string, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  'sans-serif': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  monospace: "'Courier New', Courier, monospace",
};

export function readerFontFamily(value: string): string {
  return FONT_FAMILIES[value] ?? FONT_FAMILIES.serif;
}

const ALL_SCHOLARLY_HOOKS = SCHOLARLY_CLASS_TOKENS.map((token) => `.${token}`).join(',\n');

/** Canonical article CSS. It intentionally contains no descendant type reset. */
export function buildArticleReaderStyles(
  tokens: ReaderThemeTokens,
  settings: ReaderTypographySettings
): string {
  const family = readerFontFamily(settings.fontFamily);
  return `
    :root {
      ${readerThemeTokenCss(tokens)}
      color-scheme: ${tokens.background === '#ffffff' ? 'light' : 'light dark'};
      background: var(--reader-background);
    }
    html, body {
      box-sizing: border-box;
      margin: 0;
      min-inline-size: 0;
      max-inline-size: 100%;
      overflow-x: hidden;
      background: var(--reader-background);
      color: var(--reader-foreground);
    }
    body {
      padding: clamp(1rem, 4vw, 2rem);
      font-family: ${family};
      font-size: ${settings.fontSize}px;
      line-height: ${settings.lineHeight};
      overflow-wrap: anywhere;
    }
    ${ALL_SCHOLARLY_HOOKS} {
      box-sizing: border-box;
      min-inline-size: 0;
    }
    .inc-article {
      inline-size: min(100%, var(--reader-measure));
      max-inline-size: 100%;
      margin-inline: auto;
    }
    .inc-article > header {
      margin-block-end: 2rem;
      padding-block-end: 1.1rem;
      border-block-end: 1px solid var(--reader-border);
    }
    .inc-publication {
      margin: 0 0 .55rem;
      color: var(--reader-muted-foreground);
      font-family: ${FONT_FAMILIES['sans-serif']};
      font-size: .82em;
      font-weight: 700;
      letter-spacing: .065em;
      text-transform: uppercase;
    }
    .inc-title {
      margin: 0 0 .45em;
      color: var(--reader-foreground);
      font-size: clamp(2em, 7vw, 2.7em);
      font-weight: 700;
      letter-spacing: -.025em;
      line-height: 1.08;
    }
    .inc-dek { margin: 0 0 .85em; color: var(--reader-muted-foreground); font-size: 1.12em; }
    .inc-byline { margin: 0; color: var(--reader-muted-foreground); font-size: .92em; }
    .inc-body { color: var(--reader-foreground); }
    p { margin: 0 0 1.1em; }
    h2, h3, h4, h5, h6 {
      color: var(--reader-foreground);
      font-weight: 700;
      line-height: 1.22;
      text-wrap: balance;
    }
    h2 { margin: 2.1em 0 .65em; font-size: 1.5em; letter-spacing: -.015em; }
    h3 { margin: 1.75em 0 .55em; font-size: 1.25em; }
    h4 { margin: 1.5em 0 .5em; font-size: 1.08em; }
    h5 { margin: 1.35em 0 .45em; font-size: 1em; }
    h6 { margin: 1.25em 0 .4em; font-size: .94em; letter-spacing: .025em; }
    strong, b { font-weight: 700; }
    em, i { font-style: italic; }
    small { font-size: .875em; }
    sup, sub { position: relative; font-size: .75em; line-height: 0; vertical-align: baseline; }
    sup { inset-block-start: -.5em; }
    sub { inset-block-end: -.25em; }
    a {
      color: var(--reader-link);
      text-decoration: underline;
      text-decoration-thickness: .09em;
      text-underline-offset: .16em;
    }
    a:visited { color: var(--reader-link); }
    a:hover { text-decoration-thickness: .14em; }
    a:focus-visible, [tabindex="0"]:focus-visible {
      outline: 3px solid var(--reader-focus);
      outline-offset: 3px;
      border-radius: 2px;
    }
    ::selection { background: ${tokens.accent}55; }
    ul, ol { margin: 0 0 1.1em; padding-inline-start: 1.65em; }
    ul { list-style: disc outside; }
    ol { list-style: decimal outside; }
    li { margin-block: .32em; }
    li > ul, li > ol { margin-block: .35em; }
    dl { margin: 0 0 1.1em; }
    dt { margin-block-start: .8em; font-weight: 700; }
    dd { margin: .25em 0 .8em 1.4em; }
    blockquote {
      margin: 1.4em 0;
      padding: .15em 0 .15em 1.1em;
      border-inline-start: 3px solid var(--reader-accent);
      color: var(--reader-muted-foreground);
      font-style: italic;
    }
    code, kbd, samp {
      padding: .08em .3em;
      border: 1px solid var(--reader-border);
      border-radius: .25em;
      background: var(--reader-muted-surface);
      font-family: ${FONT_FAMILIES.monospace};
      font-size: .88em;
    }
    pre {
      margin: 1.25em 0;
      padding: 1em;
      border: 1px solid var(--reader-border);
      border-radius: .4em;
      background: var(--reader-muted-surface);
      font-family: ${FONT_FAMILIES.monospace};
      font-size: .88em;
      white-space: pre;
    }
    pre code { padding: 0; border: 0; background: transparent; }
    hr { margin: 2em 0; border: 0; border-block-start: 1px solid var(--reader-border); }
    .inc-abstract {
      margin: 1.8em 0 2.2em;
      padding: 1.15em 1.25em;
      border: 1px solid var(--reader-border);
      border-radius: .5em;
      background: var(--reader-surface);
    }
    .inc-abstract > :first-child { margin-block-start: 0; font-size: 1.15em; }
    .inc-abstract > :last-child { margin-block-end: 0; }
    .inc-theorem, .inc-proof {
      margin: 1.45em 0;
      padding: 1em 1.1em;
      border-inline-start: 4px solid var(--reader-accent);
      background: var(--reader-surface);
    }
    .inc-proof { border-inline-start-style: double; }
    .inc-theorem-title, .inc-proof-title { margin: 0 0 .55em; font-weight: 700; }
    figure { margin: 1.7em 0; max-inline-size: 100%; }
    img { display: block; inline-size: auto; max-inline-size: 100%; block-size: auto; margin-inline: auto; }
    figcaption, caption {
      color: var(--reader-muted-foreground);
      font-size: .875em;
      line-height: 1.45;
    }
    figcaption { margin-block-start: .65em; text-align: center; }
    caption { caption-side: top; padding-block-end: .6em; text-align: start; font-weight: 600; }
    table { border-collapse: collapse; inline-size: max-content; min-inline-size: 100%; }
    .inc-table-wrap table { white-space: nowrap; }
    th, td { padding: .55em .7em; border: 1px solid var(--reader-border); text-align: start; vertical-align: top; }
    th { background: var(--reader-muted-surface); font-weight: 700; }
    cite, .inc-citation, .inc-footnote-ref { font-size: .9em; }
    .inc-footnotes, .inc-bibliography {
      margin-block-start: 2.4em;
      padding-block-start: .8em;
      border-block-start: 1px solid var(--reader-border);
      font-size: .92em;
    }
    .inc-reference, .inc-footnote { margin-block: .6em; }
    .inc-footnote-backref { margin-inline-start: .35em; }
    math { max-inline-size: 100%; font-size: 1em; }
    p math:not([display="block"]) { display: inline; }
    math[display="block"] { display: block; inline-size: max-content; min-inline-size: max-content; }
    .inc-equation { display: flex; align-items: center; gap: .85em; margin: 1.35em 0; }
    .inc-equation-number { margin-inline-start: auto; white-space: nowrap; }
    .inc-wide, .inc-table-wrap, .inc-equation, pre {
      inline-size: 100%;
      max-inline-size: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-inline: contain;
      -webkit-overflow-scrolling: touch;
    }
    .inc-article, .inc-body, figure, img, math, pre, table { max-inline-size: 100%; }
    mark[data-search-highlight], mark[data-viewer-search] {
      color: var(--reader-foreground);
      background: ${tokens.accent}55;
      border-radius: 2px;
      padding: 0 2px;
    }
    @media (max-width: 520px) {
      body { padding: 1rem; }
      .inc-title { font-size: 2em; }
      .inc-abstract { padding: .9em; }
    }
  `;
}

/** Add a tab stop only when a wide region actually overflows. */
export function syncCanonicalOverflowAccessibility(doc: Document): void {
  doc
    .querySelectorAll<HTMLElement>('.inc-wide, .inc-table-wrap, .inc-equation, pre')
    .forEach((region) => {
      const overflows = region.scrollWidth > region.clientWidth + 1;
      if (overflows) {
        region.tabIndex = 0;
        if (!region.hasAttribute('aria-label')) {
          region.setAttribute(
            'aria-label',
            region.matches('.inc-table-wrap')
              ? 'Scrollable table'
              : region.matches('.inc-equation')
                ? 'Scrollable equation'
                : 'Scrollable content'
          );
        }
      } else {
        region.removeAttribute('tabindex');
      }
    });
}
