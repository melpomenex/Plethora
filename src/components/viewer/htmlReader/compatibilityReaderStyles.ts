import type { HtmlReaderKind } from './documentKind';
import { readerFontFamily, type ReaderTypographySettings } from './articleReaderStyles';
import { readerThemeTokenCss, type ReaderThemeTokens } from './readerThemeTokens';

/** Existing broad repair behavior, isolated away from canonical articles. */
export function buildCompatibilityReaderStyles(
  kind: Exclude<HtmlReaderKind, 'canonical-article'>,
  tokens: ReaderThemeTokens,
  settings: ReaderTypographySettings
): string {
  const legacyArxiv = kind === 'legacy-arxiv';
  return `
    :root { ${readerThemeTokenCss(tokens)} }
    html, body {
      box-sizing: border-box;
      margin: 0;
      max-inline-size: 100%;
      background: var(--reader-background) !important;
      color: var(--reader-foreground) !important;
    }
    body {
      max-width: ${legacyArxiv ? '68ch' : '850px'};
      margin: 0 auto;
      padding: 1.5rem 1.25rem;
      font: ${settings.fontSize}px/${settings.lineHeight} ${readerFontFamily(settings.fontFamily)};
      overflow-wrap: anywhere;
    }
    body * {
      color: inherit !important;
      background-color: transparent !important;
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    strong, b { font-weight: 700 !important; }
    em, i { font-style: italic !important; }
    small { font-size: .875em !important; }
    sup, sub { font-size: .75em !important; line-height: 0 !important; }
    h1, h2, h3, h4, h5, h6 { font-weight: 700 !important; line-height: 1.25 !important; }
    h1 { font-size: 2rem !important; margin: 0 0 .8em !important; }
    h2 { font-size: 1.55rem !important; margin: 1.8em 0 .65em !important; }
    h3 { font-size: 1.25rem !important; margin: 1.5em 0 .55em !important; }
    h4, h5, h6 { font-size: 1.05rem !important; margin: 1.25em 0 .45em !important; }
    p { margin: 0 0 1em !important; }
    ul, ol { margin: 0 0 1em 1.5em !important; padding-inline-start: 1.25em !important; }
    li { display: list-item !important; margin: .3em 0 !important; }
    a { color: var(--reader-link) !important; text-decoration: underline !important; text-underline-offset: 2px; }
    a:focus-visible { outline: 3px solid var(--reader-focus) !important; outline-offset: 3px; }
    img, figure, table, math, pre { max-inline-size: 100% !important; }
    img { block-size: auto !important; }
    table { border-collapse: collapse !important; inline-size: 100% !important; }
    th, td { border: 1px solid var(--reader-border) !important; padding: .5rem .65rem !important; text-align: start !important; }
    th { background: var(--reader-muted-surface) !important; font-weight: 700 !important; }
    figcaption, caption, .pdf-header .meta, .page-header { color: var(--reader-muted-foreground) !important; font-size: .875em !important; }
    pre, .ltx_equation, .ltx_equationgroup, .ltx_tabular, .ltx_table, .page-content table {
      overflow-x: auto !important;
      -webkit-overflow-scrolling: touch;
    }
    .ltx_document { max-inline-size: 68ch !important; margin-inline: auto !important; }
    .ltx_page_navbar, .arxiv-html-header, .ds-announcement, .ds-site-footer, .ltx_TOC, dialog { display: none !important; }
    .page {
      margin-block-end: 1.25rem !important;
      padding: 2.5rem 2.75rem !important;
      border: 1px solid var(--reader-border) !important;
      border-radius: 8px !important;
      background: var(--reader-surface) !important;
    }
    .pdf-header { margin-block-end: 1.5rem !important; padding: 1.5rem 0 1.25rem !important; border-block-end: 2px solid var(--reader-border) !important; text-align: center !important; }
    .mw-parser-output { max-inline-size: 100% !important; }
    code, pre { border: 1px solid var(--reader-border) !important; border-radius: 4px !important; background: var(--reader-muted-surface) !important; }
    pre { padding: 1rem !important; }
    blockquote { margin: 1em 0 !important; padding-inline-start: 1rem !important; border-inline-start: 3px solid var(--reader-accent) !important; color: var(--reader-muted-foreground) !important; font-style: italic !important; }
    ::selection { background: ${tokens.accent}55; }
  `;
}
