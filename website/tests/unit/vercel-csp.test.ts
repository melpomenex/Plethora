import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Vercel content security policy', () => {
  it('allows Astro island hydration without enabling eval', () => {
    const config = JSON.parse(readFileSync(join(websiteRoot, 'vercel.json'), 'utf8'));
    const globalHeaders = config.headers.find((entry: { source: string }) => entry.source === '/(.*)');
    const csp = globalHeaders?.headers.find(
      (header: { key: string }) => header.key === 'Content-Security-Policy',
    )?.value;

    assert.equal(typeof csp, 'string');
    assert.match(csp, /script-src 'self' 'unsafe-inline'/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.match(csp, /frame-ancestors 'none'/);
  });
});
