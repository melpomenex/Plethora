import { describe, expect, it } from 'vitest';

import {
  normalizeArticleUrl,
  siteNameFromUrl,
} from '../urlNormalizer';

describe('normalizeArticleUrl', () => {
  it('strips tracking parameters but keeps meaningful ones', () => {
    const result = normalizeArticleUrl(
      'https://Example.com/story/12?utm_source=twitter&utm_campaign=launch&fbclid=abc123&id=12&gclid=zzz'
    );
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('https://example.com/story/12?id=12');
    expect(result.original).toBe(
      'https://Example.com/story/12?utm_source=twitter&utm_campaign=launch&fbclid=abc123&id=12&gclid=zzz'
    );
  });

  it('strips any utm_* prefixed parameter, including unknown ones', () => {
    const result = normalizeArticleUrl(
      'https://example.com/a?utm_reader=huh&utm_newthing=1&keep=2'
    );
    expect(result.normalized).toBe('https://example.com/a?keep=2');
  });

  it('removes the fragment and default ports, lowercases the host', () => {
    expect(
      normalizeArticleUrl('HTTPS://WWW.Example.COM:443/path#section').normalized
    ).toBe('https://www.example.com/path');
    expect(
      normalizeArticleUrl('http://example.com:80/x').normalized
    ).toBe('http://example.com/x');
  });

  it('keeps non-default ports', () => {
    expect(normalizeArticleUrl('https://example.com:8443/x').normalized).toBe(
      'https://example.com:8443/x'
    );
  });

  it('rejects non-http schemes', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'about:blank']) {
      const result = normalizeArticleUrl(url);
      expect(result.valid).toBe(false);
      expect(result.normalized).toBe('');
    }
  });

  it('rejects private/loopback hosts', () => {
    for (const url of [
      'http://localhost/dev',
      'http://127.0.0.1/x',
      'http://10.0.0.1/x',
      'http://192.168.1.10/admin',
      'http://172.16.0.5/x',
      'http://169.254.169.254/metadata',
      'http://0.0.0.0/',
    ]) {
      const result = normalizeArticleUrl(url);
      expect(result.valid, url).toBe(false);
    }
  });

  it('rejects unparseable input without throwing', () => {
    const result = normalizeArticleUrl('not a url at all');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.original).toBe('not a url at all');
  });

  it('treats equivalent tracked and clean URLs as the same dedupe key', () => {
    const a = normalizeArticleUrl('https://example.com/s?id=1&utm_medium=social').normalized;
    const b = normalizeArticleUrl('https://example.com/s?utm_campaign=x&id=1#top').normalized;
    expect(a).toBe(b);
  });
});

describe('siteNameFromUrl', () => {
  it('derives a site name from the host, dropping www', () => {
    expect(siteNameFromUrl('https://www.motherjones.com/politics/2026/08/x/')).toBe(
      'motherjones.com'
    );
    expect(siteNameFromUrl('https://example.org')).toBe('example.org');
  });

  it('returns undefined for invalid input', () => {
    expect(siteNameFromUrl('::::')).toBeUndefined();
  });
});
