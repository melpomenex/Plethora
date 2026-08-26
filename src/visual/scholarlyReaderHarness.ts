import fixtureHtml from '../utils/articleImport/__tests__/fixtures/arxiv-html-regression/page.html?raw';
import fixtureFigure from '../utils/articleImport/__tests__/fixtures/arxiv-html-regression/moe-routing.svg?inline';
import { normalizeArticle } from '../utils/articleImport/articleNormalizer';
import { parseHtml } from '../utils/articleImport/domUtils';
import { extractArxivHtml } from '../utils/articleImport/engines/site-specific/arxiv';
import { sanitizeArticleHtml } from '../utils/articleImport/sanitizer';
import { classifyHtmlReader } from '../components/viewer/htmlReader/documentKind';
import { prepareHtmlDocument } from '../components/viewer/htmlReader/prepareHtmlDocument';
import { ensureReaderStylesheet } from '../components/viewer/htmlReader/readerStylesheet';
import {
  buildArticleReaderStyles,
  syncCanonicalOverflowAccessibility,
} from '../components/viewer/htmlReader/articleReaderStyles';
import { resolveReaderThemeTokens } from '../components/viewer/htmlReader/readerThemeTokens';
import { biolumeAbyssTheme, modernDarkTheme, snowTheme } from '../themes/builtin';
import type { Theme } from '../types/theme';

const THEMES = new Map<string, Theme>(
  [biolumeAbyssTheme, snowTheme, modernDarkTheme].map((theme) => [theme.id, theme])
);
const shell = document.querySelector<HTMLElement>('#scholarly-reader-shell')!;
const frame = document.querySelector<HTMLIFrameElement>('#scholarly-reader-frame')!;
const assetBase = 'https://arxiv.org/html/2410.07524v1/';

let currentTheme =
  THEMES.get(new URLSearchParams(window.location.search).get('theme') ?? '') ??
  biolumeAbyssTheme;
let typography = { fontSize: 16, lineHeight: 1.65, fontFamily: 'serif' as const };

function applyReaderStyle(theme: Theme): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  const style = ensureReaderStylesheet(doc);
  const tokens = resolveReaderThemeTokens({}, theme);
  style.textContent = buildArticleReaderStyles(tokens, typography);
  doc.documentElement.dataset.readerKind = 'canonical-article';
  doc.documentElement.dataset.themeId = theme.id;
  syncCanonicalOverflowAccessibility(doc);
  frame.contentWindow?.requestAnimationFrame(() => syncCanonicalOverflowAccessibility(doc));
}

async function mount(): Promise<void> {
  const source = parseHtml(fixtureHtml);
  const candidate = extractArxivHtml(source, assetBase);
  if (!candidate?.title) throw new Error('Fixture did not produce a canonical candidate');
  const normalized = normalizeArticle({
    contentHtml: candidate.contentHtml,
    title: candidate.title,
    authors: candidate.byline?.split(',').map((author) => author.trim()) ?? [],
    siteName: 'arXiv',
    baseUrl: assetBase,
  });
  const sanitized = await sanitizeArticleHtml(normalized.article.contentHtml);
  // Mirror persisted article assets without network or registry state. Remote
  // loopback images are deliberately rejected by the production media policy.
  const persisted = parseHtml(sanitized.html);
  persisted.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (image.getAttribute('src') === `${assetBase}moe-routing.svg`) {
      image.src = 'plethora-asset://fixture-moe-routing';
    }
  });
  const classification = classifyHtmlReader({
    fileType: 'html',
    html: persisted.body.innerHTML,
    metadata: {
      webArticle: {
        originalUrl: 'https://arxiv.org/abs/2410.07524v1',
        canonicalUrl: 'https://arxiv.org/abs/2410.07524v1',
        resolvedUrl: assetBase,
        extractor: 'site:arxiv.org',
        extractionScore: 90,
        extractionConfidence: 'high',
        extractionVersion: 3,
        importedAt: '2026-08-25T00:00:00.000Z',
      },
    },
  });
  if (classification.kind !== 'canonical-article') {
    throw new Error(`Unexpected harness reader kind: ${classification.kind}`);
  }

  const prepared = prepareHtmlDocument({
    html: persisted.body.innerHTML,
    kind: classification.kind,
    title: candidate.title,
    baseUrl: assetBase,
    preserveImages: true,
    assetRenderUrls: { 'fixture-moe-routing': fixtureFigure },
  });
  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.srcdoc = prepared;
  });
  applyReaderStyle(currentTheme);
  await document.fonts.ready;
  shell.dataset.ready = 'true';
}

declare global {
  interface Window {
    __scholarlyReaderHarness: {
      setTheme: (themeId: string) => void;
      setPreviewTheme: (themeId: string) => void;
      setTypography: (next: Partial<typeof typography>) => void;
      currentThemeId: () => string;
    };
  }
}

window.__scholarlyReaderHarness = {
  setTheme(themeId) {
    const next = THEMES.get(themeId);
    if (!next) throw new Error(`Unknown harness theme: ${themeId}`);
    currentTheme = next;
    applyReaderStyle(next);
  },
  setPreviewTheme(themeId) {
    const next = THEMES.get(themeId);
    if (!next) throw new Error(`Unknown harness preview theme: ${themeId}`);
    applyReaderStyle(next);
  },
  setTypography(next) {
    typography = { ...typography, ...next };
    applyReaderStyle(currentTheme);
  },
  currentThemeId: () => currentTheme.id,
};

void mount().catch((error) => {
  const status = document.querySelector<HTMLElement>('#scholarly-reader-status');
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
