import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('sitemap and robots match indexing flag', () => {
  it('robots.txt emits Disallow when noindex and Allow when index', () => {
    const source = readFileSync(join(websiteRoot, 'src/pages/robots.txt.ts'), 'utf8');
    assert.match(source, /Disallow: \//);
    assert.match(source, /Allow: \//);
    assert.match(source, /flags\.indexing === 'noindex'/);
  });

  it('sitemap omits loc entries when noindex', () => {
    const source = readFileSync(join(websiteRoot, 'src/pages/sitemap.xml.ts'), 'utf8');
    assert.match(source, /flags\.indexing === 'noindex'/);
    assert.match(source, /urlset/);
  });
});
