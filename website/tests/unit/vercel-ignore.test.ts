import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Vercel source packaging', () => {
  it('ignores only the root demo directory, not website demo components', () => {
    const rules = readFileSync(join(repoRoot, '.vercelignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim());

    assert.ok(rules.includes('/demo/'));
    assert.ok(!rules.includes('demo/'));
  });
});
