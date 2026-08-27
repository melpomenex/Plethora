import { describe, expect, it } from 'vitest';
import {
  docBaseHref,
  resolveEffectiveResourceBase,
  stripBaseElements,
} from '../resourceBase';

/** Resolve one media reference the way every importer now does. */
function resolve(src: string, base: string): string {
  return new URL(src, base).toString();
}

describe('resolveEffectiveResourceBase', () => {
  it('resolves version-prefixed arXiv figure srcs against the verbatim document URL', () => {
    // Live arXiv markup: <img src="2410.07524v1/upcycle.png"> on a document
    // URL WITHOUT a trailing slash.
    const { base, source } = resolveEffectiveResourceBase({
      requestedUrl: 'https://arxiv.org/html/2410.07524v1',
      finalUrl: 'https://arxiv.org/html/2410.07524v1',
    });
    expect(base).toBe('https://arxiv.org/html/2410.07524v1');
    expect(source).toBe('final');
    expect(resolve('2410.07524v1/upcycle.png', base)).toBe(
      'https://arxiv.org/html/2410.07524v1/upcycle.png'
    );
  });

  it('resolves the versionless (latest) document serving version-prefixed srcs', () => {
    const { base } = resolveEffectiveResourceBase({
      requestedUrl: 'https://arxiv.org/html/2410.07524',
    });
    expect(resolve('2410.07524v2/upcycle.png', base)).toBe(
      'https://arxiv.org/html/2410.07524v2/upcycle.png'
    );
  });

  it('never appends a trailing slash to the document URL', () => {
    const { base } = resolveEffectiveResourceBase({
      requestedUrl: 'https://arxiv.org/html/2410.07524v1',
    });
    expect(base.endsWith('/')).toBe(false);
  });

  it('resolves bare, ./, ../, root-relative, protocol-relative, and absolute srcs', () => {
    const { base } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/articles/2026/research/',
    });
    expect(resolve('image.png', base)).toBe('https://example.com/articles/2026/research/image.png');
    expect(resolve('./image.png', base)).toBe('https://example.com/articles/2026/research/image.png');
    expect(resolve('../image.png', base)).toBe('https://example.com/articles/2026/image.png');
    expect(resolve('/root-image.png', base)).toBe('https://example.com/root-image.png');
    expect(resolve('//cdn.example.org/image.png', base)).toBe('https://cdn.example.org/image.png');
    expect(resolve('https://other.example/abs.png', base)).toBe('https://other.example/abs.png');
  });

  it('preserves query strings, fragments, and encoded paths through resolution', () => {
    const { base } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/a/b?session=1',
    });
    expect(resolve('c/d%20e.png?w=2#frag', base)).toBe(
      'https://example.com/a/c/d%20e.png?w=2#frag'
    );
    expect(resolve('?w=3', base)).toBe('https://example.com/a/b?w=3');
  });

  it('normalizes protocol-relative srcs to https under an https document', () => {
    const { base } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/secure/',
    });
    expect(resolve('//cdn.example.org/image.png', base)).toBe(
      'https://cdn.example.org/image.png'
    );
    // An http document keeps the protocol-relative scheme it inherited.
    const http = resolveEffectiveResourceBase({
      requestedUrl: 'http://example.com/insecure/',
    });
    expect(resolve('//cdn.example.org/image.png', http.base)).toBe(
      'http://cdn.example.org/image.png'
    );
  });

  it('honors a safe cross-origin <base href>', () => {
    const { base, source } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/articles/foo',
      finalUrl: 'https://example.com/articles/foo',
      docBaseHref: 'https://cdn.example.org/assets/',
    });
    expect(base).toBe('https://cdn.example.org/assets/');
    expect(source).toBe('doc-base');
    expect(resolve('img/foo.png', base)).toBe('https://cdn.example.org/assets/img/foo.png');
  });

  it('honors a same-origin absolute <base href> with a deeper path', () => {
    const { base, source } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/articles/foo/',
      docBaseHref: 'https://example.com/articles/static/v2/',
    });
    expect(base).toBe('https://example.com/articles/static/v2/');
    expect(source).toBe('doc-base');
  });

  it('rejects javascript: and other non-http(s) base hrefs', () => {
    for (const evil of [
      'javascript:alert(1)',
      'data:text/html,evil',
      'file:///etc/passwd',
      'ftp://files.example.org/',
    ]) {
      const { base, source } = resolveEffectiveResourceBase({
        requestedUrl: 'https://example.com/a/',
        finalUrl: 'https://example.com/a/',
        docBaseHref: evil,
      });
      expect(source, `base href ${evil} must be ignored`).toBe('final');
      expect(base).toBe('https://example.com/a/');
    }
  });

  it('rejects relative-only base hrefs (path, root-relative, protocol-relative)', () => {
    for (const relative of ['assets/', '/assets/', '//cdn.example.org/assets/']) {
      const { base, source } = resolveEffectiveResourceBase({
        requestedUrl: 'https://example.com/a/',
        finalUrl: 'https://example.com/a/',
        docBaseHref: relative,
      });
      expect(source, `relative base href ${relative} must be ignored`).toBe('final');
      expect(base).toBe('https://example.com/a/');
    }
  });

  it('rejects whitespace-only and empty base hrefs', () => {
    expect(
      resolveEffectiveResourceBase({
        requestedUrl: 'https://example.com/a/',
        docBaseHref: '   ',
      }).source
    ).toBe('requested');
    expect(
      resolveEffectiveResourceBase({
        requestedUrl: 'https://example.com/a/',
        docBaseHref: '',
      }).source
    ).toBe('requested');
    expect(
      resolveEffectiveResourceBase({ requestedUrl: 'https://example.com/a/', docBaseHref: null })
        .source
    ).toBe('requested');
  });

  it('prefers the redirect-resolved final URL over the requested URL', () => {
    const { base, source } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/paper',
      finalUrl: 'https://example.com/paper/v2/',
    });
    expect(source).toBe('final');
    expect(base).toBe('https://example.com/paper/v2/');
    expect(resolve('fig.png', base)).toBe('https://example.com/paper/v2/fig.png');
  });

  it('falls back to the requested URL when no final URL is reported', () => {
    const { base, source } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/paper/',
    });
    expect(source).toBe('requested');
    expect(base).toBe('https://example.com/paper/');
  });

  it('falls back to the requested URL when the final URL is not http(s)', () => {
    const { base, source } = resolveEffectiveResourceBase({
      requestedUrl: 'https://example.com/paper/',
      finalUrl: 'about:blank',
    });
    expect(source).toBe('requested');
    expect(base).toBe('https://example.com/paper/');
  });

  it('degrades defensively when neither URL parses as http(s)', () => {
    const { base, source } = resolveEffectiveResourceBase({
      requestedUrl: 'not-a-url',
      finalUrl: undefined,
    });
    expect(source).toBe('requested');
    expect(base).toBe('not-a-url');
  });
});

describe('docBaseHref', () => {
  it('reads the first <base href> of a document', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><base href="https://cdn.example.org/v2/"><base href="https://evil.invalid/"></head><body></body></html>',
      'text/html'
    );
    expect(docBaseHref(doc)).toBe('https://cdn.example.org/v2/');
  });

  it('returns null for documents without a base or with an empty href', () => {
    expect(docBaseHref(new DOMParser().parseFromString('<p>x</p>', 'text/html'))).toBeNull();
    expect(
      docBaseHref(new DOMParser().parseFromString('<base href="">', 'text/html'))
    ).toBeNull();
  });
});

describe('stripBaseElements', () => {
  it('removes base elements from documents and fragments', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><base href="https://cdn.example.org/"></head><body><div><base href="https://evil.invalid/"><img src="a.png"></div></body></html>',
      'text/html'
    );
    stripBaseElements(doc);
    expect(doc.querySelectorAll('base')).toHaveLength(0);
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('a.png');
  });
});
