#!/usr/bin/env node
/**
 * Invokes scripts/marketing/check-freshness.mjs when change C has landed.
 * Until that file exists this is a no-op. Placeholder screenshots fail CI
 * only when PUBLIC_INDEXING=index (see check-dist.mjs).
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(websiteRoot, '..');
const freshness = join(repoRoot, 'scripts/marketing/check-freshness.mjs');
const indexing = process.env.PUBLIC_INDEXING === 'index' ? 'index' : 'noindex';

if (!existsSync(freshness)) {
  console.log(
    'check:assets: scripts/marketing/check-freshness.mjs not found — skipping until marketing assets (change C) land.',
  );
  process.exit(0);
}

if (indexing !== 'index') {
  console.log(
    'check:assets: PUBLIC_INDEXING is not index — skipping freshness enforcement (placeholders must not fail CI yet).',
  );
  process.exit(0);
}

const result = spawnSync(process.execPath, [freshness], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
