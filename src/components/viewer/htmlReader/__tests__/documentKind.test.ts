import { describe, expect, it } from 'vitest';
import { classifyHtmlReader } from '../documentKind';

const canonical =
  '<article class="inc-article"><header><h1 class="inc-title">Title</h1></header><div class="inc-body"><p>Body</p></div></article>';

describe('classifyHtmlReader', () => {
  it('requires provenance and valid direct canonical structure', () => {
    expect(
      classifyHtmlReader({
        fileType: 'html',
        html: canonical,
        metadata: { webArticle: { extractor: 'defuddle' } as never },
      }).kind
    ).toBe('canonical-article');

    const spoofed = classifyHtmlReader({ fileType: 'html', html: canonical, metadata: {} });
    expect(spoofed.kind).toBe('raw-html');
    expect(spoofed.diagnostics[0]).toContain('provenance was absent');

    const malformed = classifyHtmlReader({
      fileType: 'html',
      html: '<article class="inc-article"><p>No direct body</p></article>',
      metadata: { webArticle: { extractor: 'defuddle' } as never },
    });
    expect(malformed.kind).toBe('raw-html');
    expect(malformed.diagnostics[0]).toContain('did not match');
  });

  it('separates raw fallback, legacy arXiv, browser capture, OCR, and raw HTML', () => {
    expect(
      classifyHtmlReader({
        fileType: 'html',
        html: canonical.replace('inc-article', 'inc-article inc-raw'),
        metadata: { webArticle: { extractor: 'raw-fallback' } as never },
      }).kind
    ).toBe('canonical-raw-fallback');
    expect(
      classifyHtmlReader({
        fileType: 'html',
        html: '<article class="ltx_document">Legacy</article>',
        metadata: { arxivId: '2410.1', htmlUrl: 'https://arxiv.org/html/2410.1' },
      }).kind
    ).toBe('legacy-arxiv');
    expect(
      classifyHtmlReader({
        fileType: 'html',
        html: '<p>Capture</p>',
        metadata: { source: 'browser_extension' },
      }).kind
    ).toBe('browser-capture');
    expect(
      classifyHtmlReader({ fileType: 'pdf', html: '<div class="page">OCR</div>', surface: 'ocr-html' }).kind
    ).toBe('ocr-html');
    expect(classifyHtmlReader({ fileType: 'html', html: '<p>Raw</p>' }).kind).toBe('raw-html');
  });

  it('classifies preserved capture failures ahead of every other kind (FR-15)', () => {
    expect(
      classifyHtmlReader({
        fileType: 'html',
        html: '<p>This link was saved, but its content could not be captured.</p>',
        metadata: {
          source: 'https://example.com/a',
          captureFailed: { reason: 'network', at: '2026-09-26T00:00:00Z' },
        },
      }).kind
    ).toBe('capture-failed');

    // Even canonical-looking content stays a capture-failure source: the
    // marker is authoritative until a retry upgrades the record.
    expect(
      classifyHtmlReader({
        fileType: 'html',
        html: canonical,
        metadata: {
          webArticle: { extractor: 'defuddle' } as never,
          captureFailed: { reason: 'extraction', at: '2026-09-26T00:00:00Z' },
        },
      }).kind
    ).toBe('capture-failed');

    // Without the marker, the same placeholder content classifies raw.
    expect(
      classifyHtmlReader({
        fileType: 'html',
        html: '<p>This link was saved, but its content could not be captured.</p>',
        metadata: { source: 'https://example.com/a' },
      }).kind
    ).toBe('raw-html');
  });
});

